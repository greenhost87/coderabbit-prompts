# coderabbit-prompts

`coderabbit-prompts` is a small collection of Codex/OpenAI skills for collecting and processing CodeRabbit findings from GitHub pull requests.

The repository currently contains two skills:

- `coderabbit-collect` collects CodeRabbit `Potential issue` feedback from a pull request and writes a normalized `coderabbit-findings-<branch-slug>.md` file into the target repository root.
- `coderabbit-do` reads the branch-specific findings file and returns the next `OPEN` finding to validate and resolve.

## Requirements

- [Bun](https://bun.sh/) 1.x or newer
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- Git
- A local checkout of the repository you want to inspect

## Installation

1. Clone this repository:

```bash
git clone https://github.com/greenhost87/coderabbit-prompts.git
cd coderabbit-prompts
```

2. Create your Codex skills directory:

```bash
mkdir -p "$HOME/.codex/skills"
```

3. Symlink the skills into that directory:

```bash
ln -s "$(pwd)/coderabbit-collect" "$HOME/.codex/skills/coderabbit-collect"
ln -s "$(pwd)/coderabbit-do" "$HOME/.codex/skills/coderabbit-do"
```

4. Verify the required tools:

```bash
bun --version
gh auth status
```

After installation, the skills can be invoked in Codex as `$coderabbit-collect` and `$coderabbit-do`.

## Usage

### Collect findings from a pull request

Run the collector from the root of the repository you want to analyze:

```bash
/absolute/path/to/coderabbit-prompts/coderabbit-collect/scripts/run-collect "https://github.com/owner/repo/pull/123"
```

If `gh pr view` can resolve the current branch to a pull request, you can omit the URL:

```bash
/absolute/path/to/coderabbit-prompts/coderabbit-collect/scripts/run-collect
```

The script writes a `coderabbit-findings-<branch-slug>.md` file into the current repository root.

### Resolve the next open finding

Run the helper from the root of the target repository:

```bash
/absolute/path/to/coderabbit-prompts/coderabbit-do/scripts/run-do
```

The helper prints the first `OPEN` finding from the branch-specific findings file so it can be reviewed or fixed in the current run.

## Development

Run the focused test suites from each skill directory:

```bash
cd coderabbit-collect && bun test
cd coderabbit-do && bun test
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
