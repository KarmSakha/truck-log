from django.http import JsonResponse
from django.urls import path

from . import views

urlpatterns = [
    path("trips/", views.trip_create, name="trip_create"),
    path("trips/<uuid:trip_id>/", views.trip_detail, name="trip_detail"),
    path("geocode/", views.geocode_search, name="geocode_search"),
    path("health/", lambda r: JsonResponse({"ok": True}), name="health"),
]
