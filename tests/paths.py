# Chemins communs aux tests : dépôt, dossier de travail temporaire (TEST_TMP, sinon /tmp/to-do-list-tests).
import os, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = pathlib.Path(os.environ.get('TEST_TMP', '/tmp/to-do-list-tests'))
SHOTS = TMP / 'shots'
SHOTS.mkdir(parents=True, exist_ok=True)

import subprocess as _sp
def test_build(name='build', **env):
    """Version de test (avec le point d'accès window.__odj) construite dans le dossier temporaire."""
    out = TMP / name
    e = dict(os.environ, TEST_HOOKS='1', OUT_DIR=str(out))
    e.update({k: str(v) for k, v in env.items()})
    _sp.run(['node', str(ROOT / 'build.mjs')], env=e, check=True, capture_output=True)
    return out
BUILD = test_build()
