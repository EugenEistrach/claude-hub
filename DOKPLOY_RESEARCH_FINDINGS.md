# Dokploy Research Findings

## Current Issue
- Service is deployed but not accessible at https://claude.perfux.dev
- Getting 404 errors, suggesting Traefik routing issue
- SSL certificate shows "TRAEFIK DEFAULT CERT" instead of Let's Encrypt

## Known Facts
- App name: `claude-hub-hglfmx`
- Compose ID: `QvPCj1T7xzdyYF5s-QVYm`
- Domain configured: `claude.perfux.dev`
- Deployment status: "done"

## Research Findings

### 1. Traefik Label Format (PENDING)
- Need to find exact format from docs
- Current attempt uses: `traefik.http.routers.claude-hub-hglfmx-webhook.*`
- Status: NOT VERIFIED

### 2. Domain Configuration Method (PENDING)
- Domain was added via API: `POST /api/domain.create`
- Parameters used: host, https, port, serviceName, certificateType
- Need to verify if additional configuration required

### 3. Service Naming Convention (PENDING)
- Need to determine how Dokploy names services
- Is it based on app name, service name in compose, or something else?

## Documentation Sources Checked
1. https://docs.dokploy.com/docs/core/domain - General info only, no technical details
2. https://docs.dokploy.com/docs/core/traefik/overview - No technical details, just mentions Traefik is used
3. https://docs.dokploy.com/docs/core/docker-compose/domains - FOUND THE ANSWER!

## SOLUTION FOUND

### Traefik Label Format
From the official docs, the correct format is:
```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.<UNIQUE-RULE>.rule=Host(`your-domain.dokploy.com`)
  - traefik.http.routers.<UNIQUE-RULE>.entrypoints=web
  - traefik.http.services.<UNIQUE-RULE>.loadbalancer.server.port=3000
```

Key points:
- `<UNIQUE-RULE>` should be a unique identifier
- Use `entrypoints=web` for HTTP or `websecure` for HTTPS
- Must specify the internal container port

### What is UNIQUE-RULE?
- Documentation example uses `frontend-app` for a service named `frontend`
- Need to determine exact pattern Dokploy expects
- We configured domain via API with serviceName: "webhook"

### Current Investigation
- Domain was created via API, not manual labels
- Need to check if Dokploy manages labels automatically when using API

### Critical Question
Since we configured the domain through Dokploy API (`POST /api/domain.create`), do we even need Traefik labels in the compose file? The docs show manual label configuration, but we used the API which might handle this automatically.

### Hypothesis to Test
Removed all Traefik labels except `dokploy.enabled=true` since we configured domain via API. Dokploy might auto-generate the needed Traefik configuration.