# Object Fixtures

`coverage.json` is the complete persisted-object inventory. `priority_vectors.json`
contains executable golden inputs for the seven highest-risk object families.

The Dart runner parses each vector with the canonical model factory, performs a
localized title mutation, writes Markdown, reparses it, and verifies that the
unknown frontmatter field survives while the known mutation wins.
