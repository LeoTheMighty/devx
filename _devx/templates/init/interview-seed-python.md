## (from /devx-init) Test runner — pytest, unittest, or other?

A `pyproject.toml` was detected. The local-CI gate needs a concrete test
command; without one `/devx` Phase 5 stops gating.

**Options:** pytest (default — broadest plugin ecosystem) / unittest (stdlib, zero deps) / other (e.g. tox-orchestrated).
**Recommendation:** pytest unless you have a strong reason to stick with unittest.

- [ ] Confirm the test runner + the exact command devx should run.

## (from /devx-init) Dependency manager — pip + requirements.txt, poetry, uv, pdm, hatch?

Decides what file devx checks for "are deps in sync" and what commands the
agent allow-list permits unprompted.

**Options:** pip + requirements.txt (default — simplest, most universal) / poetry / uv (fastest) / pdm / hatch.
**Recommendation:** uv for new projects (fast + lockfile + pyproject native);
poetry if you already have one; pip + requirements.txt for the Python 2 era.

- [ ] Pick a dependency manager.

## (from /devx-init) Type checker — mypy strict, pyright, or none?

Static checking is informational under YOLO and gating under PROD.

**Options:** mypy strict / mypy default / pyright / none.
**Recommendation:** pyright (faster, default in many editors) — opt into
mypy strict only if you've owned a mypy stack before.

- [ ] Pick a type checker (or `none`).
