import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register ts-node's ESM loader without using the deprecated --loader flag.
register('ts-node/esm', pathToFileURL('./'));
