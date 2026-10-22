import { commandRegistry } from '../dist/registry.js';
import { writeCompletionScripts } from '../dist/utils/completion/script-files.js';

await writeCompletionScripts(commandRegistry);
