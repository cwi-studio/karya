# Karya (CWI Studio) — additions to the Plane API. Kept in this package so upstream merges touch one include line.
# SPDX-License-Identifier: AGPL-3.0-only
"""Karya Go (the phone app at /go/): what it needs to draft and list work items. Creating goes through upstream's
own issue endpoint so activity, notifications and the approver guard run as usual."""

import logging
import os
from datetime import date

from django.conf import settings
from django.core.cache import cache
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, Module, Project, ProjectMember

from . import go

# Every draft can cost money (speech-to-text + model), so it is metered four ways. Any limit at 0 switches drafting off.
# Worst case per day = INSTANCE_PER_DAY drafts; at 30 s of audio each that is about ₹0.25 of speech-to-text apiece.
DRAFTS_PER_HOUR = int(os.environ.get("KARYA_GO_USER_PER_HOUR", 40))
DRAFTS_PER_DAY = int(os.environ.get("KARYA_GO_USER_PER_DAY", 150))
WORKSPACE_PER_DAY = int(os.environ.get("KARYA_GO_WORKSPACE_PER_DAY", 600))
INSTANCE_PER_DAY = int(os.environ.get("KARYA_GO_INSTANCE_PER_DAY", 1000))
OPEN_GROUPS = ["backlog", "unstarted", "started"]


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
        project_projectmember__role__gte=ROLE.MEMBER.value,
    ).distinct()


def _members(project_id):
    rows = (
        ProjectMember.objects.filter(project_id=project_id, is_active=True, member__is_bot=False)
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
