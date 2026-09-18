# Build the React bundle, then serve API + static from one container.
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 DJANGO_DEBUG=False
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /app/frontend/dist ./static/frontend
ENV DJANGO_STATIC_FRONTEND=/app/static/frontend
RUN python manage.py collectstatic --noinput 2>/dev/null || true
EXPOSE 8000
CMD python manage.py migrate --noinput && \
    gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 120
