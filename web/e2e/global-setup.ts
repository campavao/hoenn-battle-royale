// Fails fast, before either webServer even boots, when the dev sidecars are missing --
// the symptom otherwise is both specs hanging on `#rom=` (loadSidecars() in app.ts
// resolves null and the shell throws deep inside runPatchingScreen).
import { sidecarsExist, SYMBOLS_PATH } from './symbols';

export default function globalSetup(): void {
  if (!sidecarsExist()) {
    throw new Error(`missing ${SYMBOLS_PATH} -- run tools/br/dev-patch.sh`);
  }
}
