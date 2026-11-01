"""Speaks lines with Kokoro. Run by narrate.ts: python -I speak.py <model> <voices> <jobs.json>, each job {text, voice, speed, out}."""

import json
import sys

import soundfile
from kokoro_onnx import Kokoro

model, voices, jobs = sys.argv[1:4]
kokoro = Kokoro(model, voices)
with open(jobs) as file:
    for job in json.load(file):
        samples, rate = kokoro.create(job["text"], voice=job["voice"], speed=job["speed"], lang="en-us")
        soundfile.write(job["out"], samples, rate)
        print(json.dumps({"out": job["out"], "seconds": len(samples) / rate}), flush=True)
