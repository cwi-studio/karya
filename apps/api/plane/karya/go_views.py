# Karya (CWI Studio) — additions to the Plane API. Kept in this package so upstream merges touch one include line.
# SPDX-License-Identifier: AGPL-3.0-only
"""Karya Go (the phone app at /go/): what it needs to draft, list and show work items. Creating and editing go through
upstream's own issue endpoints so activity, notifications and the approver guard run as usual; these views only read."""

import logging
import os
from datetime import date
from uuid import UUID

from django.conf import settings
from django.core.cache import cache
from django.db.models import Case, Count, IntegerField, Q, Value, When
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    FileAsset,
    Issue,
    IssueAssignee,
    IssueComment,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
)

from . import go
from .models import KaryaStateApprover

# Every draft can cost money (speech-to-text + model), so it is metered four ways. Any limit at 0 switches drafting off.
# Worst case per day = INSTANCE_PER_DAY drafts; at 30 s of audio each that is about ₹0.25 of speech-to-text apiece.
DRAFTS_PER_HOUR = int(os.environ.get("KARYA_GO_USER_PER_HOUR", 40))
DRAFTS_PER_DAY = int(os.environ.get("KARYA_GO_USER_PER_DAY", 150))
WORKSPACE_PER_DAY = int(os.environ.get("KARYA_GO_WORKSPACE_PER_DAY", 600))
INSTANCE_PER_DAY = int(os.environ.get("KARYA_GO_INSTANCE_PER_DAY", 1000))
OPEN_GROUPS = ["backlog", "unstarted", "started"]
STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"]
PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


logger = logging.getLogger("plane.karya.go")


def _over_limit(user_id, workspace_id):
    """Count this draft against every meter; return the message for the first one it breaks, or None."""
    today = date.today().isoformat()
    meters = [
        (
            f"karya:go:u:{user_id}:h",
            3600,
            DRAFTS_PER_HOUR,
            "That's a lot of tickets in one hour. Give it a few minutes.",
        ),
        (
            f"karya:go:u:{user_id}:{today}",
            86400,
            DRAFTS_PER_DAY,
            "You've hit today's limit for Karya Go. Use full Karya.",
        ),
        (f"karya:go:w:{workspace_id}:{today}", 86400, WORKSPACE_PER_DAY, "Your workspace hit today's Karya Go limit."),
        (f"karya:go:all:{today}", 86400, INSTANCE_PER_DAY, "Karya Go is resting for today. Use full Karya."),
    ]
    for key, ttl, limit, message in meters:
        cache.add(key, 0, ttl)
        if cache.incr(key) > limit:
            return message
    return None


def _projects(slug, user):
    """Projects where the user can create work items (members and admins, not guests)."""
    return Project.objects.filter(
        workspace__slug=slug,
        archived_at__isnull=True,
        project_projectmember__member=user,
        project_projectmember__is_active=True,
        project_projectmember__deleted_at__isnull=True,  # joins skip the soft-delete manager
        project_projectmember__role__gte=ROLE.MEMBER.value,
    ).distinct()


def _members(project_id):
    rows = (
        ProjectMember.objects.filter(
            project_id=project_id, is_active=True, member__is_bot=False, member__is_active=True
        )
        .select_related("member", "member__avatar_asset")
        .order_by("member__display_name")
    )
    return [
        {
            "id": str(row.member_id),
            "display_name": row.member.display_name or row.member.first_name or row.member.email.split("@")[0],
            "full_name": f"{row.member.first_name} {row.member.last_name}".strip(),
            "avatar_url": row.member.avatar_url or "",
        }
        for row in rows
    ]


def _modules(project_id):
    return [
        {"id": str(m["id"]), "name": m["name"]}
        for m in Module.objects.filter(project_id=project_id, archived_at__isnull=True)
        .exclude(status__in=["completed", "cancelled"])
        .order_by("name")
        .values("id", "name")
    ]


def _states(project_id):
    """The project's states in board order, each with the people who may move work items into it."""
    approvers = {}
    for state_id, user_id in KaryaStateApprover.objects.filter(project_id=project_id).values_list(
        "state_id", "approver_id"
    ):
        approvers.setdefault(str(state_id), []).append(str(user_id))
    rows = State.objects.filter(project_id=project_id).order_by("sequence")
    order = {g: i for i, g in enumerate(STATE_GROUPS)}
    return sorted(
        (
            {
                "id": str(s.id),
                "name": s.name,
                "color": s.color,
                "group": s.group,
                "default": s.default,
                "approver_ids": approvers.get(str(s.id), []),
            }
            for s in rows
            if s.group in order
        ),
        key=lambda s: order[s["group"]],  # stable: keeps the sequence order inside a group
    )


def _labels(project_id):
    return [
        {"id": str(row["id"]), "name": row["name"], "color": row["color"] or ""}
        for row in Label.objects.filter(project_id=project_id).order_by("name").values("id", "name", "color")
    ]


def _speaker(user):
    name = f"{user.first_name} {user.last_name}".strip()
    return f"{user.display_name} ({name}), id {user.id}" if name else f"{user.display_name}, id {user.id}"


class KaryaGoContextEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        projects = [
            {
                "id": str(p.id),
                "name": p.name,
                "identifier": p.identifier,
                "emoji": (p.logo_props or {}).get("emoji", {}).get("value", "") if p.logo_props else "",
                "members": _members(p.id),
                "modules": _modules(p.id) if p.module_view else [],
                "states": _states(p.id),
                "labels": _labels(p.id),
            }
            for p in _projects(slug, request.user).order_by("name")
        ]
        return Response(
            {
                "me": {"id": str(request.user.id), "display_name": request.user.display_name},
                "voice": go.voice_enabled(),
                "smart": go.llm_enabled(),
                "file_size_limit": settings.FILE_SIZE_LIMIT,
                "projects": projects,
            },
            status=status.HTTP_200_OK,
        )


class KaryaGoDraftEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        project = _projects(slug, request.user).filter(pk=request.data.get("project_id") or None).first()
        if not project:
            return Response({"error": "Pick a project you can add work items to."}, status=status.HTTP_400_BAD_REQUEST)

        audio = request.FILES.get("audio")
        if audio and audio.size > go.MAX_AUDIO_BYTES:  # before metering: refused uploads cost nothing
            return Response({"error": "That recording is too long. Keep it under 30 seconds."}, status=413)
        refused = _over_limit(request.user.id, project.workspace_id)
        if refused:
            logger.warning("karya go: draft refused (%s) user=%s workspace=%s", refused, request.user.id, slug)
            return Response({"error": refused}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        logger.info(
            "karya go: draft user=%s workspace=%s project=%s audio_bytes=%s text_chars=%s",
            request.user.id,
            slug,
            project.identifier,
            audio.size if audio else 0,
            len(str(request.data.get("text") or "")),
        )

        try:
            text = go.transcribe(audio) if audio else str(request.data.get("text") or "").strip()
            if not text:
                return Response({"error": "Say or type what needs doing."}, status=status.HTTP_400_BAD_REQUEST)
            members, modules = _members(project.id), (_modules(project.id) if project.module_view else [])
            draft, understood = go.make_draft(text, {"name": project.name}, members, modules, _speaker(request.user))
        except go.GoError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        return Response(
            {"transcript": text, "understood": understood, "draft": draft},
            status=status.HTTP_200_OK,
        )


class KaryaGoMineEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        rows = (
            Issue.issue_objects.filter(
                workspace__slug=slug,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
                project__project_projectmember__deleted_at__isnull=True,
                project__archived_at__isnull=True,
                issue_assignee__assignee=request.user,
                issue_assignee__deleted_at__isnull=True,
                state__group__in=OPEN_GROUPS,
            )
            .distinct()
            .order_by("-updated_at")
            .values(
                "id",
                "name",
                "sequence_id",
                "priority",
                "target_date",
                "updated_at",
                "project_id",
                "project__identifier",
                "state__name",
                "state__color",
                "state__group",
            )[:50]
        )
        return Response(
            [
                {
                    "id": str(r["id"]),
                    "name": r["name"],
                    "key": f"{r['project__identifier']}-{r['sequence_id']}",
                    "project_id": str(r["project_id"]),
                    "priority": r["priority"],
                    "target_date": r["target_date"],
                    "updated_at": r["updated_at"],
                    "state": {"name": r["state__name"], "color": r["state__color"], "group": r["state__group"]},
                }
                for r in rows
            ],
            status=status.HTTP_200_OK,
        )


def _ids(value):
    return [v for v in str(value or "").split(",") if v]


ITEM_FIELDS = (
    "id",
    "name",
    "sequence_id",
    "priority",
    "start_date",
    "target_date",
    "created_at",
    "updated_at",
    "created_by_id",
    "project_id",
    "project__identifier",
    "state_id",
    "state__name",
    "state__color",
    "state__group",
)


def _items(rows):
    """values() rows -> the app's work item shape, with assignees, labels and modules in three queries."""
    rows = list(rows)
    ids = [r["id"] for r in rows]
    links = {str(i): {"assignee_ids": [], "label_ids": [], "module_ids": []} for i in ids}
    for issue_id, user_id in IssueAssignee.objects.filter(issue_id__in=ids, assignee__is_active=True).values_list(
        "issue_id", "assignee_id"
    ):
        links[str(issue_id)]["assignee_ids"].append(str(user_id))
    for issue_id, label_id in IssueLabel.objects.filter(issue_id__in=ids, label__deleted_at__isnull=True).values_list(
        "issue_id", "label_id"
    ):
        links[str(issue_id)]["label_ids"].append(str(label_id))
    for issue_id, module_id in ModuleIssue.objects.filter(
        issue_id__in=ids, module__archived_at__isnull=True, module__deleted_at__isnull=True
    ).values_list("issue_id", "module_id"):
        links[str(issue_id)]["module_ids"].append(str(module_id))
    return [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "key": f"{r['project__identifier']}-{r['sequence_id']}",
            "project_id": str(r["project_id"]),
            "priority": r["priority"],
            "start_date": r["start_date"],
            "target_date": r["target_date"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "created_by": str(r["created_by_id"]) if r["created_by_id"] else None,
            "state": {
                "id": str(r["state_id"]) if r["state_id"] else None,
                "name": r["state__name"] or "",
                "color": r["state__color"] or "",
                "group": r["state__group"] or "backlog",
            },
            **links[str(r["id"])],
        }
        for r in rows
    ]


def _visible(slug, user):
    """Every work item in the projects the user is a member or admin of: the same items full Karya shows them."""
    return Issue.issue_objects.filter(project__in=_projects(slug, user))


class KaryaGoItemsEndpoint(BaseAPIView):
    """All work items the user can see, filtered and sorted on the server, a page at a time.

    Query: project (id; empty = all my projects), scope (all | mine | created | unassigned), groups (state groups,
    default open ones), states, priorities, assignees ("none" = nobody), labels, modules (comma-separated ids),
    q (title or KEY-123), sort (updated | due | priority | created), offset, limit.
    `counts` is the number of matching items per state id over the whole result, not just this page."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        params = request.query_params
        qs = _visible(slug, request.user)

        project = params.get("project")
        if project:
            qs = qs.filter(project_id=project) if _is_uuid(project) else qs.none()

        scope = params.get("scope", "all")
        if scope == "mine":
            qs = qs.filter(issue_assignee__assignee=request.user, issue_assignee__deleted_at__isnull=True)
        elif scope == "created":
            qs = qs.filter(created_by=request.user)
        elif scope == "unassigned":
            qs = qs.filter(_nobody())

        states = [s for s in _ids(params.get("states")) if _is_uuid(s)]
        if states:
            qs = qs.filter(state_id__in=states)
        else:
            groups = [g for g in _ids(params.get("groups")) if g in STATE_GROUPS] or OPEN_GROUPS
            qs = qs.filter(state__group__in=groups)

        priorities = [p for p in _ids(params.get("priorities")) if p in PRIORITY_RANK]
        if priorities:
            qs = qs.filter(priority__in=priorities)

        assignees = _ids(params.get("assignees"))
        if assignees:
            people = [a for a in assignees if _is_uuid(a)]
            match = Q(
                issue_assignee__assignee_id__in=people,
                issue_assignee__deleted_at__isnull=True,
            )
            if "none" in assignees:
                match = match | _nobody() if people else _nobody()
            qs = qs.filter(match)

        labels = [label for label in _ids(params.get("labels")) if _is_uuid(label)]
        if labels:
            qs = qs.filter(label_issue__label_id__in=labels, label_issue__deleted_at__isnull=True)

        modules = [m for m in _ids(params.get("modules")) if _is_uuid(m)]
        if modules:
            qs = qs.filter(issue_module__module_id__in=modules, issue_module__deleted_at__isnull=True)

        text = (params.get("q") or "").strip()[:200]
        if text:
            match = Q(name__icontains=text)
            key = text.upper().rsplit("-", 1)
            if len(key) == 2 and key[1].isdigit():
                match |= Q(project__identifier=key[0], sequence_id=int(key[1]))
            elif text.isdigit():
                match |= Q(sequence_id=int(text))
            qs = qs.filter(match)

        ids = qs.values("id").distinct()
        matching = Issue.issue_objects.filter(id__in=ids)
        counts = {
            str(row["state_id"]): row["n"] for row in matching.order_by().values("state_id").annotate(n=Count("id"))
        }

        sort = params.get("sort", "updated")
        if sort == "due":
            order = [
                Case(When(target_date__isnull=True, then=Value(1)), default=Value(0)),
                "target_date",
                "-updated_at",
            ]
        elif sort == "priority":
            rank = Case(
                *[When(priority=p, then=Value(r)) for p, r in PRIORITY_RANK.items()],
                default=Value(9),
                output_field=IntegerField(),
            )
            order = [rank, "-updated_at"]
        elif sort == "created":
            order = ["-created_at"]
        else:
            order = ["-updated_at"]

        offset = _int(params.get("offset"), 0, 0, 1_000_000)
        limit = _int(params.get("limit"), PAGE_SIZE, 1, MAX_PAGE_SIZE)
        total = sum(counts.values())
        rows = matching.order_by(*order, "id").values(*ITEM_FIELDS)[offset : offset + limit]
        return Response(
            {
                "items": _items(rows),
                "total": total,
                "counts": counts,
                "next_offset": offset + limit if offset + limit < total else None,
            },
            status=status.HTTP_200_OK,
        )


class KaryaGoItemEndpoint(BaseAPIView):
    """One work item with what the phone shows: description, comments and attachments."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, issue_id):
        row = _visible(slug, request.user).filter(pk=issue_id).values(*ITEM_FIELDS, "description_html").first()
        if not row:
            return Response({"error": "This work item isn't there, or you can't see it."}, status=404)
        item = _items([row])[0]
        item["description_html"] = row["description_html"] or ""
        comments = (
            IssueComment.objects.filter(issue_id=issue_id, actor__isnull=False)
            .select_related("actor", "actor__avatar_asset")
            .order_by("-created_at")[:50]
        )
        item["comments"] = [
            {
                "id": str(c.id),
                "html": c.comment_html or "",
                "created_at": c.created_at,
                "edited": bool(c.edited_at),
                "actor": {
                    "id": str(c.actor_id),
                    "display_name": c.actor.display_name or c.actor.first_name or "Someone",
                    "avatar_url": c.actor.avatar_url or "",
                },
            }
            for c in reversed(list(comments))
        ]
        assets = FileAsset.objects.filter(
            issue_id=issue_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=True,
        ).order_by("created_at")
        base = f"/api/assets/v2/workspaces/{slug}/projects/{row['project_id']}/issues/{issue_id}/attachments/"
        item["attachments"] = [
            {
                "id": str(a.id),
                "name": (a.attributes or {}).get("name") or "file",
                "size": (a.attributes or {}).get("size") or a.size or 0,
                "type": (a.attributes or {}).get("type") or "",
                "url": f"{base}{a.id}/",
            }
            for a in assets
        ]
        return Response(item, status=status.HTTP_200_OK)


def _nobody():
    return ~Q(id__in=IssueAssignee.objects.values("issue_id"))  # the default manager skips removed assignees


def _is_uuid(value):
    try:
        UUID(str(value))
        return True
    except ValueError:
        return False


def _int(value, default, low, high):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default
