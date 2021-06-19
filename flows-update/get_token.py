#!/usr/bin/env python3

import re
import sys
for i in sys.stdin:
  g = re.match('.*\<.*name="_csrf".*value="(.*)"\>.*', i);
  if g is not None:
    print (g.group(1))
