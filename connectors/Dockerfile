FROM python:3.12-slim

# System deps needed by psycopg2-binary and google-ads gRPC
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer-cached unless requirements change)
COPY connectors/requirements.txt ./connectors/requirements.txt
RUN pip install --no-cache-dir -r connectors/requirements.txt

# Copy connector source
COPY connectors/ ./connectors/

# Ensure package root is importable as `connectors.*`
RUN touch __init__.py

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# ManagedIdentityCredential is used automatically when running in Azure.
# AZURE_KEYVAULT_URI is set as a Container App environment variable.
CMD ["python", "-m", "connectors.scheduler.scheduler"]
