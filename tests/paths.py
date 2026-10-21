# Chemins communs aux tests : dépôt, dossier de travail temporaire (TEST_TMP, sinon /tmp/to-do-list-tests).
import os, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = pathlib.Path(os.environ.get('TEST_TMP', '/tmp/to-do-list-tests'))
SHOTS = TMP / 'shots'
SHOTS.mkdir(parents=True, exist_ok=True)
