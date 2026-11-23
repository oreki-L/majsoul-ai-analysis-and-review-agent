# Historical v0.16.8 teaching fixtures

These files preserve the v0.16.8 Agent, fact-card and explanation-contract behavior for the existing A/B and S1/S2/S3 harness regression tests. Production loads `extension/` instead.

`agent.js` is a browser-script fixture loaded by the VM harness, not a standalone Node module. The fact-card and explanation fixtures use the unchanged production analysis/snapshot helpers for test loading. This small fixture directory is not a complete replay archive: formal historical evaluation still requires its original frozen code and fingerprints, including the v0.16.8 version gate. Do not bypass those checks to run an old contract against a newer product.

The exact original evaluation source files remain archived with the private campaign evidence. No original game records or model answers are included here.
