# Karya (CWI Studio) — Karya Go, the phone app at /go/.
# SPDX-License-Identifier: AGPL-3.0-only
"""Contract tests for Karya Go's endpoints (plane/karya/go_views.py, go.py).

The speech and model services are replaced with fakes; what is tested is what Karya does with their answers: only
projects the user can add to, only ids from that project, a usable draft when the model is missing or wrong.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

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
    User,
    WorkspaceMember,
)
from plane.karya.models import KaryaStateApprover
from plane.karya import go, go_views

CONTEXT_URL = "/api/workspaces/{slug}/karya/go/context/"
DRAFT_URL = "/api/workspaces/{slug}/karya/go/draft/"
MINE_URL = "/api/workspaces/{slug}/karya/go/mine/"
ITEMS_URL = "/api/workspaces/{slug}/karya/go/items/"
ITEM_URL = "/api/workspaces/{slug}/karya/go/items/{id}/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user(workspace, name, project=None, role=15):
    unique = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{name}-{unique}@karya.test", username=f"{name}_{unique}", first_name=name.title(), display_name=name
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    if project:
        ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=role)
    return user


@pytest.fixture(autouse=True)
def _services(monkeypatch):
    cache.clear()
    monkeypatch.setattr(go, "STT_KEY", "test-key")
    monkeypatch.setattr(go, "LLM_KEY", "test-key")
    calls = {"llm": None}

    def fake_llm(prompt, schema):
        return calls["llm"](prompt, schema) if calls["llm"] else None

    monkeypatch.setattr(go, "_call_llm", fake_llm)
    monkeypatch.setattr(go, "transcribe", lambda upload: "Mayank fee receipt PDF logo kat raha hai, urgent, Friday tak")
    return calls


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="EdZen", identifier="EDZ", workspace=workspace, created_by=create_user, module_view=True
    )
    ProjectMember.objects.create(project=project, member=create_user, workspace=workspace, role=20)
    return project


@pytest.fixture
def other_project(db, workspace, create_user):
    return Project.objects.create(name="HrZen", identifier="HRZ", workspace=workspace, created_by=create_user)


@pytest.fixture
def mayank(workspace, project):
    return _user(workspace, "mayank", project)


@pytest.fixture
def module(project, workspace):
    return Module.objects.create(name="Fees", project=project, workspace=workspace)


@pytest.mark.contract
class TestContext:
    @pytest.mark.django_db
    def test_lists_projects_i_can_add_to_with_people_and_modules(self, workspace, project, mayank, module):
        response = _client(mayank).get(CONTEXT_URL.format(slug=workspace.slug))

        assert response.status_code == status.HTTP_200_OK
        assert response.data["voice"] is True
        assert response.data["file_size_limit"] > 0
        assert [p["identifier"] for p in response.data["projects"]] == ["EDZ"]
        edz = response.data["projects"][0]
        assert str(mayank.id) in [m["id"] for m in edz["members"]]
        assert edz["modules"] == [{"id": str(module.id), "name": "Fees"}]

    @pytest.mark.django_db
    def test_leaves_out_projects_where_i_am_a_guest_or_absent(self, workspace, project, other_project):
        guest = _user(workspace, "guest")
        ProjectMember.objects.create(project=project, member=guest, workspace=workspace, role=5)

        response = _client(guest).get(CONTEXT_URL.format(slug=workspace.slug))

        assert response.data["projects"] == []

    @pytest.mark.django_db
    def test_removed_member_loses_the_project(self, workspace, project, mayank):
        membership = ProjectMember.objects.get(project=project, member=mayank)
        membership.is_active = False
        membership.save()
        assert _client(mayank).get(CONTEXT_URL.format(slug=workspace.slug)).data["projects"] == []

        membership.is_active = True
        membership.deleted_at = timezone.now()
        membership.save()
        assert _client(mayank).get(CONTEXT_URL.format(slug=workspace.slug)).data["projects"] == []

    @pytest.mark.django_db
    def test_removed_workspace_member_is_refused(self, workspace, project, mayank):
        WorkspaceMember.objects.filter(workspace=workspace, member=mayank).update(is_active=False)

        for url in (CONTEXT_URL, MINE_URL):
            assert _client(mayank).get(url.format(slug=workspace.slug)).status_code == 403

    @pytest.mark.django_db
    def test_outsider_is_refused(self, workspace, project):
        outsider = User.objects.create(email="out@karya.test", username="out")

        assert _client(outsider).get(CONTEXT_URL.format(slug=workspace.slug)).status_code == 403


@pytest.mark.contract
class TestDraft:
    @pytest.mark.django_db
    def test_typed_sentence_becomes_a_draft_with_only_project_ids(self, _services, workspace, project, mayank, module):
        seen = {}

        def llm(prompt, schema):
            seen["prompt"] = prompt
            return {
                "title": "Fix school logo cut off in fee receipt PDF.",
                "description": "The logo is cropped.",
                "assignee_ids": [str(mayank.id), str(uuid4())],
                "priority": "urgent",
                "target_date": (go._today() + timedelta(days=2)).isoformat(),
                "module_id": str(module.id),
            }

        _services["llm"] = llm
        response = _client(mayank).post(
            DRAFT_URL.format(slug=workspace.slug), {"project_id": str(project.id), "text": "fee receipt logo"}
        )

        assert response.status_code == status.HTTP_200_OK
        draft = response.data["draft"]
        assert response.data["understood"] is True
        assert draft["title"] == "Fix school logo cut off in fee receipt PDF"
        assert draft["assignee_ids"] == [str(mayank.id)]
        assert draft["priority"] == "urgent"
        assert draft["module_id"] == str(module.id)
        assert "mayank" in seen["prompt"] and "Fees" in seen["prompt"]

    @pytest.mark.django_db
    def test_voice_is_transcribed_first(self, _services, workspace, project, mayank):
        _services["llm"] = lambda prompt, schema: {"title": "Fix receipt logo", "assignee_ids": [], "priority": "x"}
        audio = SimpleUploadedFile("speech.webm", b"\x1aE\xdf\xa3fake", content_type="audio/webm;codecs=opus")

        response = _client(mayank).post(
            DRAFT_URL.format(slug=workspace.slug), {"project_id": str(project.id), "audio": audio}, format="multipart"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["transcript"].startswith("Mayank fee receipt")
        assert response.data["draft"]["title"] == "Fix receipt logo"
        assert response.data["draft"]["priority"] == "none"  # unknown value dropped

    @pytest.mark.django_db
    def test_model_failure_still_gives_a_draft(self, workspace, project, mayank):
        response = _client(mayank).post(
            DRAFT_URL.format(slug=workspace.slug),
            {"project_id": str(project.id), "text": "Logo is cut off. It happens on every receipt."},
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["understood"] is False
        assert response.data["draft"]["title"] == "Logo is cut off."
        assert response.data["draft"]["assignee_ids"] == []

    @pytest.mark.django_db
    def test_project_i_am_not_in_is_refused(self, workspace, other_project, mayank):
        response = _client(mayank).post(
            DRAFT_URL.format(slug=workspace.slug), {"project_id": str(other_project.id), "text": "anything"}
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_drafts_are_rate_limited(self, monkeypatch, workspace, project, mayank):
        monkeypatch.setattr(go_views, "DRAFTS_PER_HOUR", 2)
        client, url = _client(mayank), DRAFT_URL.format(slug=workspace.slug)
        body = {"project_id": str(project.id), "text": "x"}

        assert [client.post(url, body).status_code for _ in range(3)] == [200, 200, 429]

    @pytest.mark.django_db
    def test_instance_budget_stops_everyone(self, monkeypatch, workspace, project, mayank, create_user):
        monkeypatch.setattr(go_views, "INSTANCE_PER_DAY", 1)
        url, body = DRAFT_URL.format(slug=workspace.slug), {"project_id": str(project.id), "text": "x"}

        assert _client(mayank).post(url, body).status_code == 200
        response = _client(create_user).post(url, body)
        assert response.status_code == 429
        assert "resting" in response.data["error"]

    @pytest.mark.django_db
    def test_zero_limit_switches_drafting_off(self, monkeypatch, workspace, project, mayank):
        monkeypatch.setattr(go_views, "WORKSPACE_PER_DAY", 0)
        response = _client(mayank).post(
            DRAFT_URL.format(slug=workspace.slug), {"project_id": str(project.id), "text": "x"}
        )

        assert response.status_code == 429

    @pytest.mark.django_db
    def test_oversized_audio_is_refused_before_it_costs_anything(self, monkeypatch, workspace, project, mayank):
        monkeypatch.setattr(go, "transcribe", lambda upload: pytest.fail("must not reach speech-to-text"))
        audio = SimpleUploadedFile("long.webm", b"0" * (go.MAX_AUDIO_BYTES + 1), content_type="audio/webm")

        response = _client(mayank).post(
            DRAFT_URL.format(slug=workspace.slug), {"project_id": str(project.id), "audio": audio}, format="multipart"
        )

        assert response.status_code == 413
        assert cache.get(f"karya:go:u:{mayank.id}:h") is None  # not metered


@pytest.mark.contract
class TestMine:
    @pytest.mark.django_db
    def test_lists_my_open_items_only(self, workspace, project, other_project, mayank, create_user):
        todo = State.objects.create(name="Todo", group="unstarted", project=project, workspace=workspace)
        done = State.objects.create(name="Done", group="completed", project=project, workspace=workspace)
        mine = Issue.objects.create(name="Mine", project=project, workspace=workspace, state=todo)
        finished = Issue.objects.create(name="Finished", project=project, workspace=workspace, state=done)
        Issue.objects.create(name="Not mine", project=project, workspace=workspace, state=todo)
        for issue in (mine, finished):
            IssueAssignee.objects.create(issue=issue, assignee=mayank, project=project, workspace=workspace)
        # Assigned in a project Mayank is not a member of: must not leak.
        hidden_state = State.objects.create(name="Todo", group="unstarted", project=other_project, workspace=workspace)
        hidden = Issue.objects.create(
            name="Other project", project=other_project, workspace=workspace, state=hidden_state
        )
        IssueAssignee.objects.create(issue=hidden, assignee=mayank, project=other_project, workspace=workspace)

        response = _client(mayank).get(MINE_URL.format(slug=workspace.slug))

        assert response.status_code == status.HTTP_200_OK
        assert [i["name"] for i in response.data] == ["Mine"]
        assert response.data[0]["key"] == f"EDZ-{mine.sequence_id}"
        assert response.data[0]["state"]["group"] == "unstarted"


@pytest.fixture
def states(project, workspace):
    def make(name, group, sequence):
        return State.objects.create(name=name, group=group, sequence=sequence, project=project, workspace=workspace)

    return {
        "todo": make("Todo", "unstarted", 2000),
        "backlog": make("Backlog", "backlog", 1000),
        "doing": make("In Progress", "started", 3000),
        "done": make("Done", "completed", 4000),
    }


def _item(project, state, name, by, assignees=(), priority="none", **extra):
    issue = Issue.objects.create(
        name=name, project=project, workspace=project.workspace, state=state, priority=priority, **extra
    )
    Issue.objects.filter(pk=issue.pk).update(created_by=by)  # save() takes created_by from the request user
    for user in assignees:
        IssueAssignee.objects.create(issue=issue, assignee=user, project=project, workspace=project.workspace)
    return issue


@pytest.mark.contract
class TestContextStatesAndLabels:
    @pytest.mark.django_db
    def test_states_come_in_board_order_with_their_approvers(self, workspace, project, mayank, states, create_user):
        KaryaStateApprover.objects.create(
            state=states["done"], approver=create_user, project=project, workspace=workspace
        )
        Label.objects.create(name="Bug", color="#f00", project=project, workspace=workspace)

        edz = _client(mayank).get(CONTEXT_URL.format(slug=workspace.slug)).data["projects"][0]

        assert [s["name"] for s in edz["states"]] == ["Backlog", "Todo", "In Progress", "Done"]
        done = edz["states"][-1]
        assert done["group"] == "completed" and done["approver_ids"] == [str(create_user.id)]
        assert edz["labels"][0]["name"] == "Bug"


@pytest.mark.contract
class TestItems:
    @pytest.mark.django_db
    def test_member_sees_every_open_item_in_the_project_not_only_their_own(
        self, workspace, project, mayank, states, create_user
    ):
        mine = _item(project, states["todo"], "Mine", create_user, [mayank])
        theirs = _item(project, states["doing"], "Someone else's", create_user, [create_user])
        nobody = _item(project, states["backlog"], "Nobody's", create_user)
        _item(project, states["done"], "Finished", create_user, [mayank])

        data = _client(mayank).get(ITEMS_URL.format(slug=workspace.slug)).data

        assert {i["id"] for i in data["items"]} == {str(mine.id), str(theirs.id), str(nobody.id)}
        assert data["total"] == 3
        assert data["counts"] == {str(states["todo"].id): 1, str(states["doing"].id): 1, str(states["backlog"].id): 1}
        row = next(i for i in data["items"] if i["id"] == str(mine.id))
        assert row["assignee_ids"] == [str(mayank.id)] and row["state"]["id"] == str(states["todo"].id)

    @pytest.mark.django_db
    def test_scopes(self, workspace, project, mayank, states, create_user):
        mine = _item(project, states["todo"], "Mine", create_user, [mayank])
        made = _item(project, states["todo"], "Made by me", mayank, [create_user])
        nobody = _item(project, states["todo"], "Nobody's", create_user)

        def get(**q):
            return {i["name"] for i in _client(mayank).get(ITEMS_URL.format(slug=workspace.slug), q).data["items"]}

        assert get(scope="mine") == {mine.name}
        assert get(scope="created") == {made.name}
        assert get(scope="unassigned") == {nobody.name}
        assert get(assignees="none") == {nobody.name}
        assert get(assignees=f"{create_user.id},none") == {made.name, nobody.name}

    @pytest.mark.django_db
    def test_removed_assignee_counts_as_unassigned(self, workspace, project, mayank, states, create_user):
        item = _item(project, states["todo"], "Was mine", create_user, [mayank])
        IssueAssignee.objects.filter(issue=item).update(deleted_at=timezone.now())

        data = _client(mayank).get(ITEMS_URL.format(slug=workspace.slug), {"scope": "unassigned"}).data

        assert [i["id"] for i in data["items"]] == [str(item.id)]
        assert data["items"][0]["assignee_ids"] == []

    @pytest.mark.django_db
    def test_filters_and_search(self, workspace, project, mayank, states, create_user, module):
        bug = Label.objects.create(name="Bug", project=project, workspace=workspace)
        urgent = _item(project, states["todo"], "Receipt logo cut off", create_user, priority="urgent")
        IssueLabel.objects.create(issue=urgent, label=bug, project=project, workspace=workspace)
        ModuleIssue.objects.create(issue=urgent, module=module, project=project, workspace=workspace)
        done = _item(project, states["done"], "Old receipt fix", create_user)
        _item(project, states["todo"], "Other", create_user, priority="low")

        def get(**q):
            return [i["name"] for i in _client(mayank).get(ITEMS_URL.format(slug=workspace.slug), q).data["items"]]

        assert get(priorities="urgent,high") == [urgent.name]
        assert get(labels=str(bug.id)) == [urgent.name]
        assert get(modules=str(module.id)) == [urgent.name]
        assert get(q="receipt") == [urgent.name]
        assert get(q="receipt", groups="completed") == [done.name]
        assert get(states=str(states["done"].id)) == [done.name]
        assert get(q=f"edz-{urgent.sequence_id}") == [urgent.name]
        assert get(sort="priority", groups="unstarted")[0] == urgent.name

    @pytest.mark.django_db
    def test_pages(self, workspace, project, mayank, states, create_user):
        for n in range(5):
            _item(project, states["todo"], f"Item {n}", create_user)
        url = ITEMS_URL.format(slug=workspace.slug)

        first = _client(mayank).get(url, {"limit": 3}).data
        second = _client(mayank).get(url, {"limit": 3, "offset": first["next_offset"]}).data

        assert first["total"] == 5 and first["next_offset"] == 3
        assert second["next_offset"] is None
        assert len({i["id"] for i in first["items"] + second["items"]}) == 5

    @pytest.mark.django_db
    def test_projects_i_am_not_a_member_of_stay_hidden(
        self, workspace, project, other_project, mayank, states, create_user
    ):
        hidden_state = State.objects.create(name="Todo", group="unstarted", project=other_project, workspace=workspace)
        _item(other_project, hidden_state, "HrZen secret", create_user, [mayank])
        url = ITEMS_URL.format(slug=workspace.slug)

        assert _client(mayank).get(url).data["items"] == []
        assert _client(mayank).get(url, {"project": str(other_project.id)}).data["items"] == []

    @pytest.mark.django_db
    def test_guest_sees_nothing(self, workspace, project, states, create_user):
        guest = _user(workspace, "guest")
        ProjectMember.objects.create(project=project, member=guest, workspace=workspace, role=5)
        _item(project, states["todo"], "Anything", create_user, [guest])

        assert _client(guest).get(ITEMS_URL.format(slug=workspace.slug)).data["items"] == []

    @pytest.mark.django_db
    def test_removed_workspace_member_is_refused(self, workspace, project, mayank, states):
        WorkspaceMember.objects.filter(workspace=workspace, member=mayank).update(is_active=False)

        assert _client(mayank).get(ITEMS_URL.format(slug=workspace.slug)).status_code == 403


@pytest.mark.contract
class TestItem:
    @pytest.mark.django_db
    def test_detail_has_description_comments_and_attachments(self, workspace, project, mayank, states, create_user):
        item = _item(project, states["todo"], "Logo", create_user, description_html="<p>Cut off</p>")
        IssueComment.objects.create(
            issue=item, actor=create_user, comment_html="<p>On it</p>", project=project, workspace=workspace
        )
        FileAsset.objects.create(
            issue=item,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=True,
            attributes={"name": "shot.png", "size": 10, "type": "image/png"},
            asset="x/shot.png",
            project=project,
            workspace=workspace,
        )

        data = _client(mayank).get(ITEM_URL.format(slug=workspace.slug, id=item.id)).data

        assert data["description_html"] == "<p>Cut off</p>"
        assert [c["html"] for c in data["comments"]] == ["<p>On it</p>"]
        assert data["attachments"][0]["name"] == "shot.png"
        assert data["attachments"][0]["url"].endswith(f"/issues/{item.id}/attachments/{data['attachments'][0]['id']}/")

    @pytest.mark.django_db
    def test_item_in_a_project_i_am_not_in_is_404(self, workspace, other_project, mayank, create_user):
        state = State.objects.create(name="Todo", group="unstarted", project=other_project, workspace=workspace)
        item = _item(other_project, state, "Secret", create_user)

        assert _client(mayank).get(ITEM_URL.format(slug=workspace.slug, id=item.id)).status_code == 404
