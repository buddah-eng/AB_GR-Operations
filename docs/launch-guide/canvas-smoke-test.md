# Canvas Smoke Test Checklist (Vercel Deployment)

- [ ] Navigate to /canvas -- system graph loads with concept nodes
- [ ] Toggle between View and Edit modes
- [ ] In Edit mode, try adding a node (right-click canvas)
- [ ] Ctrl+Z undoes the action (may fail silently on Vercel)
- [ ] SSE connection: check if real-time updates work within 5 minutes
- [ ] After 5+ minutes, verify "disconnected" state is handled
