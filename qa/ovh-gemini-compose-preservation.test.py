#!/usr/bin/env python3
"""Regression: Gemini deployment must preserve every unrelated Docker setting."""
import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/ops/ovh-deploy-timetable-ai-gemini-v1.py"
spec = importlib.util.spec_from_file_location("gemini_ovh_deploy", SCRIPT)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def original():
    return {
        "services": {
            "functions": {
                "image": "supabase/edge-runtime:latest",
                "command": ["start", "--main-service", "/home/deno/functions/main"],
                "environment": {
                    "SUPABASE_URL": "https://example.invalid",
                    "SUPABASE_ANON_KEY": "existing-anon",
                    "SUPABASE_SERVICE_ROLE_KEY": "existing-service-role",
                    "LIVEKIT_API_KEY": "existing-livekit",
                    "BREVO_API_KEY": "existing-brevo",
                    "GROQ_API_KEY": "existing-groq",
                    "FIREBASE_SERVICE_ACCOUNT_JSON": "existing-firebase",
                },
                "volumes": [
                    {"type": "bind", "source": "/staging/old/edge", "target": "/home/deno/functions", "read_only": True},
                    {"type": "bind", "source": "/staging/keys", "target": "/home/deno/keys", "read_only": True},
                ],
                "networks": ["backend"],
                "restart": "always",
                "ports": [{"published": "9000", "target": 9000, "protocol": "tcp"}],
            },
            "db": {"image": "postgres:15", "environment": {"POSTGRES_DB": "prod"}},
            "caddy": {"image": "caddy:latest", "ports": ["443:443"]},
        }
    }


def modified():
    cfg = copy.deepcopy(original())
    cfg["services"]["functions"]["environment"]["GEMINI_API_KEY"] = "synthetic-test-key"
    cfg["services"]["functions"]["volumes"][0]["source"] = "/staging/new/edge"
    return cfg


class GeminiComposePreservation(unittest.TestCase):
    def setUp(self):
        self.gemini_env = deploy.GEMINI_ENV_FILE
        self.addCleanup(setattr, deploy, "GEMINI_ENV_FILE", self.gemini_env)

    def assertValid(self, before, after):
        deploy.verify_edge_config_preserved(
            before, after, "/staging/old/edge", "/staging/new/edge", "synthetic-test-key"
        )

    def test_only_gemini_env_and_edge_mount_change(self):
        self.assertValid(original(), modified())

    def test_original_dictionaries_remain_unchanged(self):
        before, after = original(), modified()
        baseline_b, baseline_a = copy.deepcopy(before), copy.deepcopy(after)
        self.assertValid(before, after)
        self.assertEqual(before, baseline_b)
        self.assertEqual(after, baseline_a)

    def test_delete_existing_livekit_env_fails(self):
        after = modified()
        del after["services"]["functions"]["environment"]["LIVEKIT_API_KEY"]
        with self.assertRaisesRegex(RuntimeError, "EDGE_OTHER_ENV_CHANGED"):
            self.assertValid(original(), after)

    def test_delete_existing_brevo_env_fails(self):
        after = modified()
        del after["services"]["functions"]["environment"]["BREVO_API_KEY"]
        with self.assertRaisesRegex(RuntimeError, "EDGE_OTHER_ENV_CHANGED"):
            self.assertValid(original(), after)

    def test_delete_existing_mount_fails(self):
        after = modified()
        after["services"]["functions"]["volumes"].pop()
        with self.assertRaisesRegex(RuntimeError, "EDGE_OTHER_MOUNTS_CHANGED"):
            self.assertValid(original(), after)

    def test_modify_mount_option_fails(self):
        after = modified()
        after["services"]["functions"]["volumes"][0]["read_only"] = False
        with self.assertRaisesRegex(RuntimeError, "EDGE_CODE_MOUNT_INVALID"):
            self.assertValid(original(), after)

    def test_modify_docker_service_fails(self):
        after = modified()
        after["services"]["db"]["environment"]["POSTGRES_DB"] = "wrong"
        with self.assertRaisesRegex(RuntimeError, "UNRELATED_DOCKER_SERVICE_CHANGED"):
            self.assertValid(original(), after)

    def test_modify_functions_command_fails(self):
        after = modified()
        after["services"]["functions"]["command"] = ["run-different"]
        with self.assertRaisesRegex(RuntimeError, "EDGE_OTHER_CONFIGURATION_CHANGED"):
            self.assertValid(original(), after)

    def test_wrong_api_key_rejected(self):
        after = modified()
        after["services"]["functions"]["environment"]["GEMINI_API_KEY"] = "unexpected"
        with self.assertRaisesRegex(RuntimeError, "GEMINI_SECRET_ENV_NOT_EFFECTIVE"):
            self.assertValid(original(), after)

    def test_extra_env_file_is_only_allowable_file_delta(self):
        after = modified()
        after["services"]["functions"]["env_file"] = [str(self.gemini_env)]
        self.assertValid(original(), after)
        after["services"]["functions"]["env_file"] = ["/unexpected/path"]
        with self.assertRaisesRegex(RuntimeError, "EDGE_ENV_FILE_LIST_CHANGED"):
            self.assertValid(original(), after)

    def test_docker_compose_real_merge(self):
        """Use real Docker Compose parser to check overlay list and env semantics."""
        version = subprocess.run(["docker", "compose", "version"], capture_output=True)
        if version.returncode != 0:
            self.skipTest("docker compose CLI unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            old_dir, new_dir = root/"old",root/"new"
            old_dir.mkdir()
            new_dir.mkdir()
            secret = root/"gemini.env"
            secret.write_text('GEMINI_API_KEY="synthetic-test-key"\n')
            (root/"base.yml").write_text(
                "services:\n"
                "  functions:\n"
                "    image: busybox:stable\n"
                "    command: [sleep, infinity]\n"
                "    environment:\n"
                "      SUPABASE_URL: https://example.invalid\n"
                "    volumes:\n"
                f"      - {old_dir}:/home/deno/functions:ro\n"
                "  db:\n"
                "    image: postgres:15\n"
                "    environment:\n"
                "      POSTGRES_DB: important\n"
            )
            (root/"existing.yml").write_text(
                "services:\n"
                "  functions:\n"
                "    environment:\n"
                "      BREVO_API_KEY: existing-brevo\n"
                "      GROQ_API_KEY: existing-groq\n"
                "    ports:\n"
                '      - "9000:9000"\n'
            )
            def config(paths):
                args=["docker", "compose", "--project-name", "neis-compose-check"]
                for path in paths:
                    args += ["-f", str(root/path)]
                result = subprocess.run(args + ["config", "--format", "json"],
                    cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode,0,
                    "Docker Compose could not merge the fixture")
                return json.loads(result.stdout)
            before=config(["base.yml","existing.yml"])
            original_mount=next(v for v in before["services"]["functions"]["volumes"]
                if v.get("target")=="/home/deno/functions")
            # This option comes from Docker's short-bind notation and MUST
            # survive an additive override even if the original YAML omits it.
            self.assertTrue(original_mount.get("bind",{}).get("create_host_path"))
            updated_mount=copy.deepcopy(original_mount)
            updated_mount["source"]=str(new_dir)
            (root/"gemini.yml").write_text(
                "services:\n"
                "  functions:\n"
                "    env_file:\n"
                f"      - {secret}\n"
                "    volumes:\n"
                "      - "+json.dumps(updated_mount,separators=(",",":"))+"\n"
            )
            after=config(["base.yml","existing.yml","gemini.yml"])
            deploy.GEMINI_ENV_FILE = secret
            self.assertValidCompose(before,after,old_dir,new_dir)
            self.assertEqual(after["services"]["db"],before["services"]["db"])

    def assertValidCompose(self, before, after, old_dir, new_dir):
        deploy.verify_edge_config_preserved(
            before, after, old_dir, new_dir, "synthetic-test-key"
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
