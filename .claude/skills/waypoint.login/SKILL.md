---
description: "Establish an authentication context with waypoint-web"
---

# WayPoint: login Action

**Project**: tabit

## Before You Begin

1. **Read the manifest** at `waypoint.manifest.yaml` to understand:
   - Current project state and active documents
   - What specs, plans, and tasks exist
   - Document summaries for quick context

2. **Check document status** in the manifest:
   - `specs`: Feature specifications
   - `plans`: Technical designs
   - `tasks`: Implementation tasks with status

## Instructions

This action establishes an authenticated session with the WayPoint web service, enabling you to:

- Register your agent instance with the WayPoint platform
- Access project-specific resources and templates
- Synchronize project metadata and configurations
- Enable cloud-backed features and integrations

### Step 1: Verify Network Connectivity

Ensure you can reach the WayPoint web service:

1. Check that the project has internet access configured
2. Verify no firewall or proxy restrictions block `waypoint-web` endpoints
3. Confirm DNS resolution is working properly

### Step 2: Initiate Authentication Flow

1. **Locate credentials**: Check for existing authentication tokens in:
   - Environment variables (`WAYPOINT_API_KEY`, `WAYPOINT_TOKEN`)
   - Local configuration files (`.waypoint/auth.json`, `.env`)
   - Project-level secrets storage

2. **Request authentication**: If no valid credentials exist:
   - Generate a new authentication request
   - Present authentication URL to the user if interactive approval is required
   - Wait for authorization completion

3. **Handle authentication types**:
   - **API Key**: Direct token-based authentication
   - **OAuth**: Browser-based authorization flow
   - **Service Account**: Automated machine-to-machine authentication

### Step 3: Validate Authentication

Once credentials are obtained:

1. Test the authentication by making a simple API call to waypoint-web
2. Verify the response includes valid session information
3. Confirm project access permissions are correctly scoped

### Step 4: Store Authentication Context

Securely persist the authentication context:

1. Save the authentication token to `.waypoint/auth.json`:
   ```json
   {
     "token": "<auth-token>",
     "expires_at": "<iso-timestamp>",
     "project_id": "tabit",
     "authenticated_at": "<iso-timestamp>"
   }
   ```

2. Set appropriate file permissions (read/write for owner only)
3. Add `.waypoint/auth.json` to `.gitignore` if not already present

### Step 5: Initialize Session

With valid authentication:

1. Fetch project configuration from waypoint-web
2. Synchronize any cloud-stored project metadata
3. Update local manifest with remote sync status
4. Enable any cloud-backed features or integrations

### Step 6: Verify Success

Confirm authentication is fully operational:

1. Display authentication status (user/service account name, project access)
2. Show session expiry information
3. List available cloud features now accessible
4. Confirm sync status with remote service

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint login command for FastAPI + Domain-Driven Design_