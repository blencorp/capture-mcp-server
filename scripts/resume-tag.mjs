#!/usr/bin/env node
// Prints the release tag a commit already went out in, or nothing. A re-run of the Release
// workflow checks out its original event commit; if the atomic push of that run succeeded, the
// commit is contained in the version tag the run created. That is the EARLIEST version tag
// containing it: a later release contains it too, but is not the release this commit went out in.
// Plain git and node, so it runs before dependencies are installed.
//
//   node scripts/resume-tag.mjs [<commit>]     (default HEAD)
import { execFileSync } from 'node:child_process';

const commit = process.argv[2] ?? 'HEAD';
const tags = execFileSync('git', ['tag', '--contains', commit, '--list', 'v[0-9]*', '--sort=v:refname'], { encoding: 'utf8' })
  .split('\n')
  .map(tag => tag.trim())
  .filter(tag => /^v\d+\.\d+\.\d+$/.test(tag));
if (tags[0]) console.log(tags[0]);
