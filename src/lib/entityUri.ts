// patchman:// URIs name PatchMan entities that notes link to (refers_to
// edges). Claude passes the same strings to remember(context) — keep these
// byte-identical to the formats in the MCP server instructions
// (be/internal/mcp/tools_notes.go, memoryInstructions).
export const requestUri = (requestId: string) => `patchman://request/${requestId}`;

export const k8sUri = (connId: string, namespace: string | undefined, kind: string, name: string) =>
  `patchman://k8s/${connId}/${namespace || '_'}/${kind}/${name}`;
