# Release tooling maintenance

Checked on 2026-10-18 against the projects' official documentation.

## Current upstream status

- [slsa-github-generator](https://github.com/slsa-framework/slsa-github-generator#readme)
  explicitly states that it is no longer actively maintained. Existing
  attestations remain valid and its workflows continue to work, but runtime
  deprecation fixes should not be assumed. The project recommends GitHub
  Artifact Attestations.
- [slsa-verifier](https://github.com/slsa-framework/slsa-verifier#readme) also
  states that it is no longer actively maintained and recommends
  `gh attestation verify` for GitHub Artifact Attestations.
- [actions/attest-build-provenance](https://github.com/actions/attest-build-provenance#readme)
  is a wrapper around `actions/attest` as of v4. Existing uses can continue,
  while new implementations are directed to
  [actions/attest](https://github.com/actions/attest).
- `@octokit/webhooks-definitions`, used by `create-release-pr`, is deprecated
  in favor of [Octokit webhook types/schemas](https://github.com/octokit/webhooks/issues/447).

These are implementation lifecycle changes, not deprecation of SLSA itself.

## Keep the boundaries small

1. `gh-release-notes` generates notes through a read-only npm library API.
2. `create-release-pr` owns PR creation, version/bump labels, and failure policy.
3. Trusted release workflows build, attest, and publish artifacts.

Changing the provenance provider should not require changes to note generation
or PR management. The first integration therefore replaces the Generate Release
Notes API call inside `create-release-pr`, rather than adding another Action or
copying shell/CLI installation steps into every repository.

## Provenance migration follow-up

The trusted Go and tag release workflows currently call the generic SLSA
generator. Move provenance generation into the existing reusable build/release
workflow with `actions/attest`, then verify with `gh attestation verify` and the
expected repository and signer workflow. Keep signed-tag verification separate
from artifact provenance verification.

Before removing the old generator, enumerate the artifacts it covers (including
checksums, archives, installer/runner scripts, and source/SBOM assets), ensure the
replacement covers the same intended artifacts, and update the release's consumer
verification instructions. Existing releases retain their original verification
instructions. A changed attestation format is a consumer-facing change.

[GitHub's guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating)
explains reusable workflows and verification policy for SLSA Build Level 3. Do not
claim a level solely because an attestation step exists; evaluate build isolation,
the source and signer policy, artifact coverage, and verification together.

## Rollout order

1. Release the corrected library package (the current published version is
   v0.7.0, whose declared root entry point does not match its build output).
2. Pin the resulting npm version in `create-release-pr`, rebuild the Action's
   committed distribution, and run its ncc/WASM tests.
3. Adopt that `create-release-pr` release in other repositories and remove their
   duplicate CLI-based note generation and preview jobs.
4. Migrate the shared provenance workflows independently, so library adoption
   does not also change how consumers verify downloaded artifacts.
