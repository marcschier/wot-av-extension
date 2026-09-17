"""Workflow source contracts and executable inline guards, not a YAML parser."""

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import call, patch


ROOT = Path(__file__).resolve().parents[4]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "pages.yml"
WORKFLOW = WORKFLOW_PATH.read_text(encoding="utf-8")
GLOBAL, JOBS = WORKFLOW.split("\njobs:\n", 1)
REPOSITORY = "marcschier/wot-av-extension"
URL = "https://marcschier.github.io/wot-av-extension/"
SHA = "a" * 40
DIGEST = "b" * 64
PRODUCTION = (
    "github.ref == 'refs/heads/main' && "
    "(github.event_name == 'push' || github.event_name == 'workflow_dispatch')"
)
PINS = {
    "checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
    "setup-node": "820762786026740c76f36085b0efc47a31fe5020",
    "configure-pages": "45bfe0192ca1faeb007ade9deae92b16b8254a0d",
    "upload-pages-artifact": "fc324d3547104276b827a68afc52ff2a11cc49c9",
    "deploy-pages": "368f82528645a54fb793d4d04e342629a3f51346",
}


def job_source(name):
    match = re.search(
        rf"^  {re.escape(name)}:\n.*?(?=^  [a-z][a-z0-9-]*:\n|\Z)",
        JOBS, re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"Missing workflow job: {name}")
    return match.group()


def job_steps(name):
    return re.split(r"(?m)(?=^      - name: )", job_source(name))[1:]


def step_source(job, step_id):
    matches = [
        step for step in job_steps(job)
        if re.search(rf"^        id: {re.escape(step_id)}$", step, re.MULTILINE)
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one workflow step: {job}.{step_id}")
    return matches[0]


def inline_python(job, step_id):
    step = step_source(job, step_id)
    if "        shell: python3 {0}\n" not in step:
        raise AssertionError(f"Not an inline Python step: {job}.{step_id}")
    match = re.search(r"^        run: \|\n((?:          .*\n|\n)+)", step, re.MULTILINE)
    if match is None:
        raise AssertionError(f"Missing literal Python run block: {job}.{step_id}")
    return textwrap.dedent(match.group(1))


class WorkflowDefinitionTests(unittest.TestCase):
    def test_every_main_push_and_main_pr_have_no_path_filter(self):
        events = GLOBAL.split("\non:\n", 1)[1].split("\npermissions:\n", 1)[0]
        self.assertEqual(events, (
            "  push:\n    branches: [main]\n"
            "  pull_request:\n    branches: [main]\n"
            "  workflow_dispatch:\n"
        ))

    def test_whole_production_queue_preserves_running_and_pending_runs(self):
        concurrency = GLOBAL.split("\nconcurrency:\n", 1)[1]
        self.assertEqual(concurrency, (
            "  group: ${{ github.event_name == 'pull_request' && "
            "format('pages-pr-{0}', github.event.number) || 'pages' }}\n"
            "  cancel-in-progress: false\n"
            "  queue: max\n"
        ))
        self.assertEqual(WORKFLOW.count("concurrency:"), 1)

    def test_only_the_three_isolated_jobs_are_declared(self):
        self.assertEqual(
            re.findall(r"^  ([a-z][a-z0-9-]*):$", JOBS, re.MULTILINE),
            ["prepare", "deploy", "smoke"],
        )
        self.assertEqual(WORKFLOW.count("    runs-on: ubuntu-24.04\n"), 3)

    def test_forks_and_non_main_events_cannot_reach_deployment(self):
        self.assertIn(
            "    if: github.repository == 'marcschier/wot-av-extension'\n",
            job_source("prepare"),
        )
        header = job_source("deploy").split("    runs-on:", 1)[0]
        self.assertEqual(header, (
            "  deploy:\n"
            "    needs: prepare\n"
            "    if: >-\n"
            "      github.repository == 'marcschier/wot-av-extension' &&\n"
            "      github.ref == 'refs/heads/main' &&\n"
            "      (github.event_name == 'push' || github.event_name == 'workflow_dispatch')\n"
        ))
        for step_id in ("upload", "archive"):
            with self.subTest(step=step_id):
                self.assertIn(f"        if: {PRODUCTION}\n", step_source("prepare", step_id))

    def test_only_checkout_free_deploy_has_pages_and_oidc_authority(self):
        self.assertEqual(
            GLOBAL.split("\npermissions:\n", 1)[1].split("\nconcurrency:", 1)[0],
            "  contents: read\n",
        )
        for name, expected in (
            ("prepare", [("contents", "read")]),
            ("deploy", [("contents", "read"), ("pages", "write"), ("id-token", "write")]),
            ("smoke", [("contents", "read")]),
        ):
            with self.subTest(job=name):
                header = job_source(name).split("    steps:\n", 1)[0]
                self.assertEqual(
                    re.findall(r"^      ([a-z-]+): (read|write|none)$", header, re.MULTILINE),
                    expected,
                )
                self.assertEqual("    environment:\n" in header, name == "deploy")
        deploy = job_source("deploy")
        self.assertNotIn("actions/checkout@", deploy)
        self.assertNotIn("av/tools/", deploy)
        self.assertIn("      name: github-pages\n", deploy)
        self.assertIn("      url: ${{ steps.deployment.outputs.page_url }}\n", deploy)
        self.assertEqual(
            re.findall(r"^        id: (\w+)$", deploy, re.MULTILINE),
            ["pages", "destination", "current", "deployment", "result"],
        )

    def test_all_actions_use_only_verified_full_commit_pins(self):
        actual = re.findall(r"^        uses: (\S+)", WORKFLOW, re.MULTILINE)
        expected = [f"actions/{name}@{sha}" for name, sha in PINS.items()]
        expected.append(f"actions/checkout@{PINS['checkout']}")
        self.assertEqual(sorted(actual), sorted(expected))
        for use in actual:
            self.assertRegex(use, r"^actions/[a-z-]+@[0-9a-f]{40}$")

    def test_each_checkout_is_immutable_and_does_not_persist_credentials(self):
        for job in ("prepare", "smoke"):
            with self.subTest(job=job):
                checkouts = [step for step in job_steps(job) if "uses: actions/checkout@" in step]
                self.assertEqual(len(checkouts), 1)
                self.assertEqual(
                    checkouts[0].split("        with:\n", 1)[1].rstrip(),
                    "          ref: ${{ github.sha }}\n          persist-credentials: false",
                )
        prepare = job_source("prepare")
        self.assertLess(prepare.index("id: source"), prepare.index("uses: actions/checkout@"))

    def test_node_is_explicit_and_normal_ci_never_restores_browser_dependencies(self):
        node = [step for step in job_steps("prepare") if "uses: actions/setup-node@" in step]
        self.assertEqual(len(node), 1)
        self.assertEqual(
            node[0].split("        with:\n", 1)[1].rstrip(),
            "          node-version: '24.12.0'\n          package-manager-cache: false",
        )
        self.assertNotRegex(WORKFLOW, r"npm\s+(?:ci|install)|pip(?:3)?\s+install")
        for prohibited in (
            "build-specs.mjs", "puppeteer", "PUPPETEER", "--release",
            "pull_request_target", "workflow_run", "self-hosted", "secrets.",
            "continue-on-error", "always()", "git push", "workflow dispatch",
        ):
            with self.subTest(prohibited=prohibited):
                self.assertNotIn(prohibited, WORKFLOW)

    def test_controls_and_snapshot_check_precede_stage_upload_and_archive_gate(self):
        prepare = job_source("prepare")
        operations = [
            "python3 -B -m unittest discover -s av/tools/publication/test -p 'test_*.py'",
            "node --test av/tools/publication/test/unit.test.mjs av/tools/publication/test/inputs.test.mjs av/tools/publication/test/check-committed.test.mjs",
            "node av/tools/publication/check-committed.mjs",
            "id: site",
            "id: upload",
            "id: archive",
        ]
        positions = [prepare.index(operation) for operation in operations]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("    needs: prepare\n", job_source("deploy"))
        self.assertIn("      content_sha256: ${{ steps.site.outputs.content_sha256 }}\n", prepare)

    def test_upload_selects_only_the_checked_tree_and_archive_uses_actual_tar(self):
        upload = step_source("prepare", "upload")
        self.assertIn("        env:\n          TAR_OPTIONS: --format=posix\n", upload)
        self.assertEqual(WORKFLOW.count("TAR_OPTIONS:"), 1)
        self.assertEqual(upload.split("        with:\n", 1)[1].rstrip(), (
            "          path: ${{ runner.temp }}/pages-site\n"
            "          name: github-pages\n"
            "          retention-days: 1\n"
            "          include-hidden-files: true"
        ))
        archive = step_source("prepare", "archive")
        self.assertIn("stage-site.py verify-archive", archive)
        self.assertIn('--archive "$RUNNER_TEMP/artifact.tar" --site "$RUNNER_TEMP/pages-site"', archive)
        archive_command = archive.split("        run: |\n", 1)[1]
        self.assertNotRegex(archive_command, r"(?:\|\||&&|continue-on-error|allow-failure)")
        deployment = step_source("deploy", "deployment")
        self.assertEqual(deployment.split("        with:\n", 1)[1].rstrip(), (
            "          artifact_name: github-pages\n          preview: false"
        ))

    def test_existing_destination_is_verified_without_pages_reenablement(self):
        pages = step_source("deploy", "pages")
        self.assertEqual(pages.split("        with:\n", 1)[1].rstrip(), "          enablement: false")
        destination = step_source("deploy", "destination")
        for variable, output in (
            ("PAGES_ORIGIN", "origin"),
            ("PAGES_BASE_URL", "base_url"),
            ("PAGES_BASE_PATH", "base_path"),
        ):
            self.assertIn(f"          {variable}: ${{{{ steps.pages.outputs.{output} }}}}\n", destination)
        self.assertEqual(WORKFLOW.count("GH_TOKEN:"), 1)
        self.assertIn("          GH_TOKEN: ${{ github.token }}\n", step_source("deploy", "current"))

    def test_current_main_is_the_last_gate_before_deploying_this_runs_artifact(self):
        steps = job_steps("deploy")
        current_index = next(i for i, step in enumerate(steps) if "        id: current\n" in step)
        self.assertIn("        id: deployment\n", steps[current_index + 1])
        self.assertIn("        if: steps.current.outputs.current == 'true'\n", steps[current_index + 1])

    def test_successful_outcome_and_validated_actual_url_gate_smoke(self):
        result = step_source("deploy", "result")
        self.assertIn("        if: steps.deployment.outcome == 'success'\n", result)
        self.assertIn("          DEPLOYED_URL: ${{ steps.deployment.outputs.page_url }}\n", result)
        deploy = job_source("deploy")
        for field, source in (
            ("deployed", "steps.result.outputs.deployed"),
            ("page_url", "steps.deployment.outputs.page_url"),
            ("base_path", "steps.pages.outputs.base_path"),
        ):
            self.assertIn(f"      {field}: ${{{{ {source} }}}}\n", deploy)
        self.assertIn(
            "    needs: [prepare, deploy]\n    if: needs.deploy.outputs.deployed == 'true'\n",
            job_source("smoke"),
        )

    def test_smoke_receives_only_public_destination_and_expected_commit_digest(self):
        public = step_source("smoke", "public")
        self.assertEqual(public.split("        env:\n", 1)[1], (
            "          SITE_URL: ${{ needs.deploy.outputs.page_url }}\n"
            "          SITE_BASE_PATH: ${{ needs.deploy.outputs.base_path }}\n"
            "          EXPECTED_COMMIT: ${{ github.sha }}\n"
            "          EXPECTED_CONTENT_SHA256: ${{ needs.prepare.outputs.content_sha256 }}\n"
            "        run: python3 -B av/tools/publication/stage-site.py smoke\n"
        ))
        smoke = job_source("smoke")
        for forbidden in ("TOKEN", "github.token", "secrets.", "cookie", "gh api"):
            self.assertNotIn(forbidden, smoke)
        self.assertIn("    timeout-minutes: 5\n", smoke)

    def test_failed_smoke_is_not_reported_as_failed_deployment_or_rollback(self):
        smoke = job_source("smoke")
        self.assertIn("        if: failure()\n", smoke)
        self.assertIn("Deployment completed, but public verification failed.", smoke)
        self.assertIn("No automatic rollback was attempted.", smoke)
        self.assertNotIn("git revert", smoke)

    def test_run_blocks_do_not_interpolate_untrusted_github_expressions(self):
        runs = re.findall(
            r"^        run:(?: \|\n(?:          .*\n|\n)*|[^\n]*\n)",
            WORKFLOW, re.MULTILINE,
        )
        self.assertEqual(len(runs), 11)
        for run in runs:
            self.assertNotIn("${{", run)

    def test_root_aliases_remain_browserless_and_packages_remain_private(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        expected = {
            "check:specs:committed": "node av/tools/publication/check-committed.mjs",
            "build:site": "python -B av/tools/publication/stage-site.py prepare",
            "check:site": "python -B av/tools/publication/stage-site.py check",
            "test:site": 'python -B -m unittest discover -s av/tools/publication/test -p "test_*.py"',
        }
        for name, command in expected.items():
            with self.subTest(command=name):
                self.assertEqual(package["scripts"][name], command)
        self.assertTrue(package["private"])
        self.assertEqual(package["scripts"]["check:specs"], "node av/tools/publication/build-specs.mjs --check")
        publication = json.loads((ROOT / "av" / "tools" / "publication" / "package.json").read_bytes())
        self.assertTrue(publication["private"])
        self.assertIn("test/check-committed.test.mjs", publication["scripts"]["test"])

    def test_pages_helpers_policies_and_tests_are_explicit_shared_inputs(self):
        ownership = json.loads((ROOT / "publication-ownership.json").read_bytes())
        required = {
            ".github/workflows/pages.yml",
            "av/tools/publication/metadata.mjs", "av/tools/publication/source-inputs.mjs",
            "av/tools/publication/check-committed.mjs", "av/tools/publication/stage-site.py",
            "av/tools/publication/test/check-committed.test.mjs",
            "av/tools/publication/test/test_site.py", "av/tools/publication/test/test_workflow.py",
            "av/support/publication/source-input-manifest.schema.json",
            "av/support/publication/provenance-normalization.json",
            "av/support/publication/site-policy.json", "av/support/publication/site-files.json",
            "av/support/publication/committed-verification.md",
            "av/support/publication/site-staging.md", "av/support/publication/pages-deployment.md",
        }
        self.assertLessEqual(required, set(ownership["sharedAuthoredFiles"]))
        for name in required:
            with self.subTest(path=name):
                self.assertTrue(ROOT.joinpath(*name.split("/")).is_file())

    def test_source_seal_is_owned_generated_evidence_not_a_circular_input(self):
        ownership = json.loads((ROOT / "publication-ownership.json").read_bytes())
        name = "av/support/publication/source-input-manifest.json"
        self.assertIn(name, ownership["sharedPublication"]["generatedFiles"])
        self.assertIn(name, ownership["onvifAuthoredGlobs"])
        self.assertNotIn(name, ownership["sharedAuthoredFiles"])
        ignored = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        for pattern in ("*.json", "source-input-manifest.json", "/av/support/publication/"):
            self.assertNotIn(pattern, ignored)
        self.assertNotIn('"tools/publication/', json.dumps(ownership))

    def test_docs_distinguish_public_source_pending_site_and_unapproved_release(self):
        readme = (ROOT / "readme.md").read_text(encoding="utf-8")
        guide = (ROOT / "av" / "support" / "publication" / "pages-deployment.md").read_text(encoding="utf-8")
        self.assertIn("source repository is **public**", readme)
        self.assertIn("first deployment is still pending", readme)
        self.assertIn("HTTP 404", readme)
        self.assertIn("**public source repository**", guide)
        self.assertIn("**pending**", guide)
        self.assertIn("example.org", guide)
        self.assertIn("remain unapproved", guide)
        self.assertIn("No local command or CI repair step automatically commits", guide)
        for pin in PINS.values():
            self.assertIn(pin, guide)

    def test_deployment_guide_links_to_the_owned_workflow_and_producer_contract(self):
        guide_path = ROOT / "av" / "support" / "publication" / "pages-deployment.md"
        guide = guide_path.read_text(encoding="utf-8")
        links = re.findall(r"\]\(([^)]+)\)", guide)
        local_targets = {
            (guide_path.parent / link).resolve()
            for link in links if not link.startswith("https://")
        }
        self.assertEqual(local_targets, {
            WORKFLOW_PATH.resolve(),
            (ROOT / "av" / "tools" / "publication" / "README.md").resolve(),
        })


class InlineGuardCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="pages-workflow-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.output = self.directory / "github-output"
        self.summary = self.directory / "github-summary"
        self.output.write_text("", encoding="utf-8")
        self.environment = {
            "GITHUB_REPOSITORY": REPOSITORY,
            "GITHUB_EVENT_NAME": "push",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_SHA": SHA,
            "GITHUB_BASE_REF": "",
            "GITHUB_OUTPUT": str(self.output),
            "GITHUB_STEP_SUMMARY": str(self.summary),
            "RUNNER_TEMP": str(self.directory),
        }
        self.log = ""

    def execute(self, job, step, **environment):
        script = inline_python(job, step)
        capture = io.StringIO()
        with patch.dict(os.environ, self.environment | environment, clear=True), redirect_stdout(capture):
            try:
                exec(compile(script, f"{WORKFLOW_PATH}:{job}.{step}", "exec"), {})
            finally:
                self.log = capture.getvalue()

    def output_text(self):
        return self.output.read_text(encoding="utf-8")


class SourceIdentityTests(InlineGuardCase):
    def test_main_push_accepts_an_immutable_source(self):
        self.execute("prepare", "source")
        self.assertEqual(self.log, "")
        self.assertEqual(self.output_text(), "")

    def test_current_main_manual_dispatch_is_allowed(self):
        self.execute("prepare", "source", GITHUB_EVENT_NAME="workflow_dispatch")
        self.assertEqual(self.log, "")

    def test_fork_pr_merge_sha_targeting_main_is_allowed_for_checks(self):
        self.execute(
            "prepare", "source", GITHUB_EVENT_NAME="pull_request",
            GITHUB_BASE_REF="main", GITHUB_REF="refs/pull/42/merge",
            GITHUB_HEAD_REF="untrusted; not executable",
        )
        self.assertEqual(self.log, "")
        self.assertEqual(self.output_text(), "")

    def test_manual_dispatch_rejects_other_branches_tags_and_injected_refs(self):
        for ref in ("refs/heads/topic", "refs/tags/main", "refs/heads/Main", "", "refs/heads/main\nother"):
            with self.subTest(ref=ref), self.assertRaises(SystemExit) as raised:
                self.execute("prepare", "source", GITHUB_EVENT_NAME="workflow_dispatch", GITHUB_REF=ref)
            self.assertEqual(raised.exception.code, 1)
            self.assertIn("::error::Publication is restricted to the main branch.", self.log)

    def test_push_rejects_non_main_ref(self):
        with self.assertRaises(SystemExit):
            self.execute("prepare", "source", GITHUB_REF="refs/heads/topic")
        self.assertIn("restricted to the main branch", self.log)

    def test_unexpected_repository_and_repository_case_are_rejected(self):
        for repository in ("fork/wot-av-extension", "marcschier/another-repo", "MarcSchier/wot-av-extension", ""):
            with self.subTest(repository=repository), self.assertRaises(SystemExit):
                self.execute("prepare", "source", GITHUB_REPOSITORY=repository)
            self.assertIn("only publishes marcschier/wot-av-extension", self.log)

    def test_source_requires_exact_lowercase_40_hex_sha(self):
        for sha in ("", "a" * 39, "a" * 41, "A" * 40, "g" * 40, SHA + "\n", " " + SHA):
            with self.subTest(sha=sha), self.assertRaises(SystemExit):
                self.execute("prepare", "source", GITHUB_SHA=sha)
            self.assertIn("immutable commit SHA", self.log)

    def test_privileged_and_unknown_event_types_are_rejected(self):
        for event in ("pull_request_target", "workflow_run", "release", "repository_dispatch", ""):
            with self.subTest(event=event), self.assertRaises(SystemExit):
                self.execute("prepare", "source", GITHUB_EVENT_NAME=event)
            self.assertIn("event cannot request Pages publication", self.log)

    def test_pull_requests_must_target_exact_main(self):
        for base in ("topic", "Main", ""):
            with self.subTest(base=base), self.assertRaises(SystemExit):
                self.execute("prepare", "source", GITHUB_EVENT_NAME="pull_request", GITHUB_BASE_REF=base)
            self.assertIn("Pull-request checks must target main", self.log)


class StageInvocationTests(InlineGuardCase):
    run_options = {"check": True, "stdout": subprocess.PIPE, "text": True}

    def commands(self, preview=False):
        helper = [sys.executable, "-B", "av/tools/publication/stage-site.py"]
        stage = str(self.directory / "pages-site")
        prepare = helper + ["prepare", "--base-path", "/wot-av-extension/", "--output", stage]
        if preview:
            prepare.append("--preview")
        return prepare, helper + ["check", "--site", stage]

    def test_production_stages_checks_and_accepts_one_exact_digest(self):
        def staged(command, **arguments):
            if "prepare" in command:
                self.output.write_text(f"content_sha256={DIGEST}\n", encoding="utf-8")
            return subprocess.CompletedProcess(command, 0, f"content_sha256={DIGEST}\n")

        with patch("subprocess.run", side_effect=staged) as run:
            self.execute("prepare", "site")
        self.assertEqual(run.call_args_list, [call(command, **self.run_options) for command in self.commands()])
        self.assertEqual(self.output_text(), f"content_sha256={DIGEST}\n")

    def test_pull_request_staging_is_preview_without_publishable_output(self):
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, f"content_sha256={DIGEST}\n")) as run:
            self.execute("prepare", "site", GITHUB_EVENT_NAME="pull_request")
        self.assertEqual(run.call_args_list, [call(command, **self.run_options) for command in self.commands(preview=True)])
        self.assertEqual(self.output_text(), "")

    def test_prepare_failure_stops_before_tree_check(self):
        error = subprocess.CalledProcessError(2, self.commands()[0])
        with patch("subprocess.run", side_effect=error) as run, self.assertRaises(subprocess.CalledProcessError):
            self.execute("prepare", "site")
        run.assert_called_once_with(self.commands()[0], **self.run_options)
        self.assertEqual(self.output_text(), "")

    def test_tree_check_failure_is_not_replaced_by_digest_success(self):
        self.output.write_text(f"content_sha256={DIGEST}\n", encoding="utf-8")
        error = subprocess.CalledProcessError(1, self.commands()[1])
        with patch("subprocess.run", side_effect=[subprocess.CompletedProcess([], 0, f"content_sha256={DIGEST}\n"), error]) as run, self.assertRaises(subprocess.CalledProcessError):
            self.execute("prepare", "site")
        self.assertEqual(run.call_args_list, [call(command, **self.run_options) for command in self.commands()])

    def test_missing_malformed_duplicate_or_injected_digest_output_fails(self):
        for output in (
            "", "content_sha256=\n", "content_sha256=" + "b" * 63,
            "content_sha256=" + "b" * 65, "content_sha256=" + "B" * 64,
            "content_sha256=" + "g" * 64,
            f"content_sha256={DIGEST}\ncontent_sha256={DIGEST}\n",
            f"content_sha256={DIGEST}\npage_url=https://unexpected.invalid/\n",
        ):
            self.output.write_text(output, encoding="utf-8")
            with self.subTest(output=output), patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, f"content_sha256={DIGEST}\n")), self.assertRaisesRegex(SystemExit, "valid public content digest"):
                self.execute("prepare", "site")

    def test_stdout_rejects_duplicates_injection_and_disagreement(self):
        valid = f"content_sha256={DIGEST}\n"
        for prepared, checked in (
            ("", valid), (valid + valid, valid + valid), (valid, valid + valid),
            (valid + "page_url=https://unexpected.invalid/\n", valid),
            (valid, f"content_sha256={'c' * 64}\n"),
            ("content_sha256=" + "B" * 64 + "\n", valid),
        ):
            self.output.write_text(valid, encoding="utf-8")
            results = [subprocess.CompletedProcess([], 0, value) for value in (prepared, checked)]
            with self.subTest(prepared=prepared, checked=checked), patch("subprocess.run", side_effect=results), self.assertRaisesRegex(SystemExit, "identical valid public content digest"):
                self.execute("prepare", "site")

    def test_runner_output_must_match_verified_stdout(self):
        self.output.write_text(f"content_sha256={'c' * 64}\n", encoding="utf-8")
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, f"content_sha256={DIGEST}\n")), self.assertRaisesRegex(SystemExit, "valid public content digest"):
            self.execute("prepare", "site")


class DestinationTests(InlineGuardCase):
    DESTINATION = {
        "PAGES_ORIGIN": "https://marcschier.github.io",
        "PAGES_BASE_URL": URL.removesuffix("/"),
        "PAGES_BASE_PATH": "/wot-av-extension",
    }

    def test_existing_exact_https_project_metadata_is_accepted(self):
        self.execute("deploy", "destination", **self.DESTINATION)
        self.assertEqual(self.output_text(), "")

    def test_changed_scheme_origin_project_case_or_base_path_fails_closed(self):
        for key, value in (
            ("PAGES_ORIGIN", "http://marcschier.github.io"),
            ("PAGES_ORIGIN", "https://unexpected.invalid"),
            ("PAGES_ORIGIN", "https://marcschier.github.io@unexpected.invalid"),
            ("PAGES_BASE_URL", URL),
            ("PAGES_BASE_URL", "https://marcschier.github.io/WOT-AV-extension"),
            ("PAGES_BASE_PATH", "/another-project"),
            ("PAGES_BASE_PATH", "/wot-av-extension/"),
            ("PAGES_BASE_PATH", ""),
        ):
            with self.subTest(key=key, value=value), self.assertRaisesRegex(SystemExit, "approved destination"):
                self.execute("deploy", "destination", **(self.DESTINATION | {key: value}))
            self.assertEqual(self.output_text(), "")

    def test_successful_actual_deployment_url_emits_deployed_only_after_validation(self):
        self.execute("deploy", "result", DEPLOYED_URL=URL)
        self.assertEqual(self.output_text(), "deployed=true\n")

    def test_unexpected_deployment_url_never_emits_success(self):
        for url in (
            "", URL.replace("https:", "http:"), URL.removesuffix("/"),
            URL + "?unexpected=1", URL + "\ndeployed=true",
            "https://unexpected.invalid/wot-av-extension/",
            "https://marcschier.github.io/WOT-AV-extension/",
        ):
            with self.subTest(url=url), self.assertRaisesRegex(SystemExit, "unexpected public URL"):
                self.execute("deploy", "result", DEPLOYED_URL=url)
            self.assertEqual(self.output_text(), "")


class CurrentMainTests(InlineGuardCase):
    def test_matching_remote_main_emits_current_true(self):
        with patch("subprocess.check_output", return_value=SHA + "\n") as gh:
            self.execute("deploy", "current")
        gh.assert_called_once_with(
            ["gh", "api", "repos/marcschier/wot-av-extension/git/ref/heads/main", "--jq", ".object.sha"],
            text=True, timeout=30,
        )
        self.assertEqual(self.output_text(), "current=true\n")
        self.assertEqual(self.log, "")
        self.assertFalse(self.summary.exists())

    def test_stale_main_emits_false_with_an_explicit_notice_and_summary(self):
        with patch("subprocess.check_output", return_value="c" * 40 + "\n"):
            self.execute("deploy", "current")
        self.assertEqual(self.output_text(), "current=false\n")
        self.assertIn(f"::notice::Obsolete main run {SHA}; current main is {'c' * 40}. Deployment skipped.", self.log)
        self.assertEqual(
            self.summary.read_text(encoding="utf-8"),
            "Deployment skipped: this immutable run is no longer main HEAD.\n",
        )

    def test_late_old_run_cannot_follow_a_new_current_run_with_deployment(self):
        latest = "c" * 40
        with patch("subprocess.check_output", return_value=latest + "\n"):
            self.execute("deploy", "current", GITHUB_SHA=latest)
            self.assertEqual(self.output_text(), "current=true\n")
            self.output.write_text("", encoding="utf-8")
            self.execute("deploy", "current", GITHUB_SHA=SHA)
        self.assertEqual(self.output_text(), "current=false\n")
        self.assertIn("Deployment skipped.", self.log)

    def test_main_ref_api_failure_is_failure_not_a_stale_skip(self):
        error = subprocess.CalledProcessError(1, ["gh", "api"], stderr="HTTP 403")
        with patch("subprocess.check_output", side_effect=error), self.assertRaises(subprocess.CalledProcessError):
            self.execute("deploy", "current")
        self.assertEqual(self.output_text(), "")
        self.assertNotIn("Deployment skipped", self.log)
        self.assertFalse(self.summary.exists())

    def test_main_ref_api_timeout_is_failure_not_a_stale_skip(self):
        with patch("subprocess.check_output", side_effect=subprocess.TimeoutExpired(["gh", "api"], 30)):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.execute("deploy", "current")
        self.assertEqual(self.output_text(), "")
        self.assertFalse(self.summary.exists())

    def test_malformed_remote_sha_never_emits_current_or_skip(self):
        for response in (
            "", "\n", "null\n", "{}\n", "a" * 39 + "\n", "a" * 41 + "\n",
            "A" * 40 + "\n", "g" * 40 + "\n", " " + SHA + "\n",
            SHA + " \n", SHA + "\n\n", SHA + "\ncurrent=true\n",
        ):
            with self.subTest(response=response), patch("subprocess.check_output", return_value=response):
                with self.assertRaisesRegex(SystemExit, "Invalid main ref response"):
                    self.execute("deploy", "current")
            self.assertEqual(self.output_text(), "")
            self.assertFalse(self.summary.exists())

    def test_invalid_source_sha_is_rejected_before_the_main_api_call(self):
        with patch("subprocess.check_output") as gh, self.assertRaisesRegex(SystemExit, "Invalid workflow commit"):
            self.execute("deploy", "current", GITHUB_SHA="refs/heads/main")
        gh.assert_not_called()
        self.assertEqual(self.output_text(), "")


if __name__ == "__main__":
    unittest.main()
