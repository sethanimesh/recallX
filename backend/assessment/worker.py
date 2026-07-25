"""Bounded JSON-lines subprocess; stdout is protocol-only, stderr contains diagnostics."""
import contextlib
import json
import select
import signal
import sys

from assessment.inference import DiscriminativeModels, InputTooLong


def main():
    from local_runtime import inference_lease
    # Hold the shared lease while models are resident, including short warm-idle time.
    # Bound lease waiting too, including an orphan whose API parent already died.
    signal.alarm(180)
    with inference_lease(priority='grading'):
        signal.alarm(180)
        with contextlib.redirect_stdout(sys.stderr):
            models = DiscriminativeModels()
        signal.alarm(0)
        for index in range(8):
            if not select.select([sys.stdin], [], [], 15)[0]:
                break
            line = sys.stdin.readline()
            if not line:
                break
            try:
                signal.alarm(180)
                request = json.loads(line)
                with contextlib.redirect_stdout(sys.stderr):
                    results = models.assess(**request)
                output = {'concept_results': results}
            except InputTooLong:
                output = {'error':'input_too_long'}
            except Exception as error:
                print(type(error).__name__, str(error), file=sys.stderr)
                output = {'error':'model_unavailable'}
            finally:
                signal.alarm(0)
            output['retiring']=index==7
            print(json.dumps(output,ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
