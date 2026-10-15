#!/usr/bin/env python3
"""ring-tall.py --wide, for drive-all.sh (a checked-by line names a script, no flags):

    bash tools/br/drive.sh ring-wide | python3 tools/br/ring-wide.py
"""
import os
import runpy
import sys

sys.argv = [os.path.join(os.path.dirname(os.path.abspath(__file__)), "ring-tall.py"), "--wide"]
runpy.run_path(sys.argv[0], run_name="__main__")
