# Karya (CWI Studio) — additions to the Plane API. Kept in this package so upstream merges touch one include line.
# SPDX-License-Identifier: AGPL-3.0-only
from django.urls import path

from .approvals_views import KaryaStateApproverEndpoint
from .deletion_views import KaryaIssueDeleterEndpoint
from .go_views import (
    KaryaGoContextEndpoint,
    KaryaGoDraftEndpoint,
    KaryaGoItemEndpoint,
    KaryaGoItemsEndpoint,
    KaryaGoMineEndpoint,
)
from .views import KaryaUpgradeRequestEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/karya/upgrade-request/",
        KaryaUpgradeRequestEndpoint.as_view(),
        name="karya-upgrade-request",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/karya/state-approvers/",
        KaryaStateApproverEndpoint.as_view(),
        name="karya-state-approvers",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/karya/deleters/",
        KaryaIssueDeleterEndpoint.as_view(),
        name="karya-issue-deleters",
    ),
    path("workspaces/<str:slug>/karya/go/context/", KaryaGoContextEndpoint.as_view(), name="karya-go-context"),
    path("workspaces/<str:slug>/karya/go/draft/", KaryaGoDraftEndpoint.as_view(), name="karya-go-draft"),
    path("workspaces/<str:slug>/karya/go/mine/", KaryaGoMineEndpoint.as_view(), name="karya-go-mine"),
    path("workspaces/<str:slug>/karya/go/items/", KaryaGoItemsEndpoint.as_view(), name="karya-go-items"),
    path(
        "workspaces/<str:slug>/karya/go/items/<uuid:issue_id>/",
        KaryaGoItemEndpoint.as_view(),
        name="karya-go-item",
    ),
]
