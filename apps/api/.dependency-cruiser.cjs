module.exports = {
  forbidden: [
    { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
    { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true, pathNot: "^@darjeeling/shared$" } },
    { name: "module-public-only", severity: "error", from: { path: "^src/modules/([^/]+)/" }, to: { path: "^src/modules/([^/]+)/", pathNot: ["^src/modules/$1/", "\\.public\\.ts$"] } },
    { name: "domain-inward", severity: "error", from: { path: "^src/modules/[^/]+/domain/" }, to: { path: "(^src/modules/[^/]+/(application|infrastructure|interface)/|^src/(config|shared/(db|http))/|node_modules/(express|mongoose)/)" } },
    { name: "application-inward", severity: "error", from: { path: "^src/modules/[^/]+/application/" }, to: { path: "^src/modules/[^/]+/(infrastructure|interface)/" } },
    { name: "interface-no-infrastructure", severity: "error", from: { path: "^src/modules/[^/]+/interface/" }, to: { path: "^src/modules/[^/]+/infrastructure/" } },
    { name: "shared-no-modules", severity: "error", from: { path: "^src/shared/" }, to: { path: "^src/modules/" } },
  ],
  options: { tsPreCompilationDeps: true, doNotFollow: { path: "node_modules" }, tsConfig: { fileName: "tsconfig.json" }, enhancedResolveOptions: { extensions: [".ts", ".js", ".json"] } },
};



