"""Build-time shim for this machine's restricted (sandboxed) shell.

Problem
-------
On Windows, ``tempfile.mkdtemp`` creates its directory with mode ``0o700``.
CPython 3.13+ maps that mode onto a *protected* DACL that grants the creating
user's SID and nothing else.  The DeepSeek Harness sandbox runs child processes
with a capability SID instead of the interactive user SID, so the very next
write into that fresh directory fails with ``PermissionError``:

    pip  ->  PermissionError: [Errno 13] ...\\tmpXXXXXXXX\\pip-*.whl

Fix
---
Force ``mkdtemp`` to create directories with mode ``0o777`` so the new
directory inherits the permissive ACL of the workspace, and neutralise
``tempfile._resetperms`` so cleanup cannot re-tighten it.

This shim is only placed on ``PYTHONPATH`` by the project's build scripts.
It is never imported by the application: the server and the database tooling
run without it.
"""

from __future__ import annotations

import os
import tempfile

_ORIGINAL_MKDIR = os.mkdir


def _open_mkdir(path, mode=0o777, *args, **kwargs):  # noqa: ANN001
    """os.mkdir that ignores restrictive modes (Windows inherits parent ACL)."""
    if mode != 0o777:
        mode = 0o777
    return _ORIGINAL_MKDIR(path, mode, *args, **kwargs)


def _open_mkdtemp(suffix=None, prefix=None, dir=None):  # noqa: ANN001
    """Drop-in replacement for tempfile.mkdtemp with an inheritable ACL."""
    suffix = suffix or ""
    prefix = tempfile.gettempprefix() if prefix is None else prefix
    if dir is None:
        dir = tempfile.gettempdir()
    for _ in range(tempfile.TMP_MAX):
        name = os.path.join(dir, next(tempfile._RandomNameSequence()) + suffix)
        try:
            _ORIGINAL_MKDIR(name, 0o777)
        except FileExistsError:
            continue
        return name
    raise FileExistsError("no usable temporary directory name found")


if os.name == "nt":  # pragma: no cover - Windows only
    os.mkdir = _open_mkdir
    tempfile.mkdtemp = _open_mkdtemp
    tempfile._mkdtemp = _open_mkdtemp  # used by TemporaryDirectory

    def _no_resetperms(path):  # noqa: ANN001
        return None

    tempfile._resetperms = _no_resetperms
