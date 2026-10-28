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

from plane.db.models import Issue, IssueAssignee, Module, Project, ProjectMember, State, User, WorkspaceMember
from plane.karya import go, go_views

CONTEXT_URL = "/api/workspaces/{slug}/karya/go/context/"
DRAFT_URL = "/api/workspaces/{slug}/karya/go/draft/"
MINE_URL = "/api/workspaces/{slug}/karya/go/mine/"


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
