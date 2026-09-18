import uuid

from django.db import models


class Trip(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    input = models.JSONField()
    result = models.JSONField()

    class Meta:
        ordering = ["-created_at"]


class GeocodeCache(models.Model):
    key = models.CharField(max_length=512, primary_key=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
