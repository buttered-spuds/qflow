// Minimal subset of vscode used by tests.
export const Uri = {
  file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
};
