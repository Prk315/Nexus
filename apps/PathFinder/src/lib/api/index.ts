// The PathFinder data layer.
//
// Every call site imports from "../lib/api" and this barrel keeps that true, so
// splitting the old api.ts into domain modules changed no consumer. Import from
// a specific module when you want the narrower dependency; the barrel exists so
// the split was zero-risk, not because everything should come through it forever.

export * from "./goals";
export * from "./plans";
export * from "./tasks";
export * from "./systems";
export * from "./calendar";
export * from "./daily";
export * from "./week";
export * from "./notes";
export * from "./courses";
export * from "./games";
export * from "./training";
export * from "./mail";
export * from "./misc";
export * from "./teams";
