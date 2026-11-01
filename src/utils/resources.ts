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
    return fetchResourceId(noun, reference, fetchResources);
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError(`--${noun}`);
  }
  return promptResourceId(noun, await fetchResources(), options);
}

// A UUID is an id, and anything else is a name looked up in the list.
export async function fetchResourceId(
  noun: string,
  reference: string,
  fetchResources: () => Promise<NamedResource[]>,
  source = `--${noun}`,
): Promise<string> {
  if (isId(reference)) {
    return reference;
  }
  return resolveNamedResource(noun, reference, await fetchResources(), source)
    .id;
}

export function promptResourceId(
  noun: string,
  resources: NamedResource[],
  options: InteractivityOptions,
): Promise<string> {
  return promptSelect(
    `--${noun}`,
    `Which ${noun}?`,
    resources.map(({ id, name }) => ({ label: name, value: id })),
    options,
  );
}

// A UUID is an id and anything else a name, both looked up in the list.
export function findResource<TResource extends NamedResource>(
  noun: string,
  reference: string,
  resources: TResource[],
): TResource | undefined {
  return isId(reference)
    ? resources.find(({ id }) => id === reference)
    : findNamedResource(noun, reference, resources, `--${noun}`);
}

export function resolveNamedResource<TResource extends NamedResource>(
  noun: string,
  name: string,
  resources: TResource[],
  source = `--${noun}`,
): TResource {
  const namedResource = findNamedResource(noun, name, resources, source);
  if (namedResource === undefined) {
    throw new UnknownNameError(noun, name, source);
  }
  return namedResource;
}

export function resolveResource<TResource extends NamedResource>(
  noun: string,
  reference: string,
  resources: TResource[],
): TResource {
  const resource = findResource(noun, reference, resources);
  if (resource === undefined) {
    throw new UnknownNameError(noun, reference);
  }
  return resource;
}

// Case-insensitive, as the API keeps app and channel names unique that way.
function findNamedResource<TResource extends NamedResource>(
  noun: string,
  name: string,
  resources: TResource[],
  source: string,
): TResource | undefined {
  const namedResources = resources.filter(
    resource => resource.name.toLowerCase() === name.toLowerCase(),
  );
  if (namedResources.length > 1) {
    throw new AmbiguousNameError(noun, name, source);
  }
  return namedResources[0];
}
