import { createWorkEnvironmentAtoms } from "@t3tools/client-runtime/work/environment";

import { connectionAtomRuntime } from "../connection/runtime";

export const workEnvironment = createWorkEnvironmentAtoms(connectionAtomRuntime);
