import { ModuleRegistry } from './registry';
import { nativeModules } from './builtin';
import { payloadModule } from './payload';
// Only bundled code is registered. Project archives never supply executable modules.
export const modules = new ModuleRegistry([...nativeModules, payloadModule]);
