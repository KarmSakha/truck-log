import os
from mimetypes import guess_type
from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, JsonResponse
from django.urls import include, path, re_path


def _dist_dir() -> Path:
    override = os.environ.get("DJANGO_STATIC_FRONTEND")
    if override:
        return Path(override)
    return settings.BASE_DIR.parent / "frontend" / "dist"


def spa(request, path=""):
    """Serve the built Vite app for every non-/api/ GET."""
    dist = _dist_dir()
    if path and ".." not in path:
        f = dist / path
        if f.is_file():
            return FileResponse(
                open(f, "rb"),
                content_type=guess_type(f.name)[0] or "application/octet-stream",
            )
    index = dist / "index.html"
    if index.is_file():
        return FileResponse(open(index, "rb"), content_type="text/html")
    return JsonResponse(
        {"detail": "API up — frontend bundle not built"}, status=404
    )


urlpatterns = [
    path("api/", include("trips.urls")),
    path("admin/", admin.site.urls),
    re_path(r"^(?P<path>.*)$", spa),
]
