import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import {
  AmbiguousNameError,
  MissingParameterError,
  UnknownNameError,
} from './errors.js';
import { promptSelect } from './prompts.js';
import { isId } from './reference.js';

interface NamedResource {
  id: string;
  name: string;
}

interface NameLookup {
  name: string;
  noun: string;
  source?: string;
}

interface ReferenceLookup {
  noun: string;
  reference: string;
}

// Without a reference, a person picks from the list, and a pipeline fails on the missing flag.
export async function fetchOrPromptResourceId({
  fetchResources,
  noun,
  options,
  reference,
}: {
  fetchResources: () => Promise<NamedResource[]>;
  noun: string;
  options: InteractivityOptions;
  reference: string | undefined;
}): Promise<string> {
  if (reference !== undefined) {
    return fetchResourceId({ fetchResources, noun, reference });
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError(`--${noun}`);
  }
  return promptResourceId(options, {
    noun,
    resources: await fetchResources(),
  });
}

// A UUID is an id, and anything else is a name looked up in the list.
export async function fetchResourceId({
  fetchResources,
  noun,
  reference,
  source,
}: ReferenceLookup & {
  fetchResources: () => Promise<NamedResource[]>;
  source?: string;
}): Promise<string> {
  if (isId(reference)) {
    return reference;
  }
  return resolveNamedResource(await fetchResources(), {
    name: reference,
    noun,
    source,
  }).id;
}

export function promptResourceId(
  options: InteractivityOptions,
  { noun, resources }: { noun: string; resources: NamedResource[] },
): Promise<string> {
  return promptSelect(options, {
    choices: resources.map(({ id, name }) => ({ label: name, value: id })),
    flag: `--${noun}`,
    message: `Which ${noun}?`,
  });
}

// A UUID is an id and anything else a name, both looked up in the list.
export function findResource<TResource extends NamedResource>(
  resources: TResource[],
  { noun, reference }: ReferenceLookup,
): TResource | undefined {
  return isId(reference)
    ? resources.find(({ id }) => id === reference)
    : findNamedResource(resources, { name: reference, noun });
}

export function resolveNamedResource<TResource extends NamedResource>(
  resources: TResource[],
  lookup: NameLookup,
): TResource {
  const namedResource = findNamedResource(resources, lookup);
  if (namedResource === undefined) {
    throw new UnknownNameError(lookup);
  }
  return namedResource;
}

export function resolveResource<TResource extends NamedResource>(
  resources: TResource[],
  { noun, reference }: ReferenceLookup,
): TResource {
  const resource = findResource(resources, { noun, reference });
  if (resource === undefined) {
    throw new UnknownNameError({ name: reference, noun });
  }
  return resource;
}

// Case-insensitive, as the API keeps app and channel names unique that way.
function findNamedResource<TResource extends NamedResource>(
  resources: TResource[],
  lookup: NameLookup,
): TResource | undefined {
  const namedResources = resources.filter(
    resource => resource.name.toLowerCase() === lookup.name.toLowerCase(),
  );
  if (namedResources.length > 1) {
    throw new AmbiguousNameError(lookup);
  }
  return namedResources[0];
}
