/// <reference path="harness.ts"/>
/// <reference path="runnerbase.ts" />
const fs = require("fs");
const path = require("path");

interface ExecResult {
    stdout: Buffer;
    stderr: Buffer;
    status: number;
}

abstract class ExternalCompileRunnerBase extends RunnerBase {
    abstract testDir: string;
    abstract report(result: ExecResult, cwd: string): string;
    enumerateTestFiles() {
        return Harness.IO.getDirectories(this.testDir);
    }
    /** Setup the runner's tests so that they are ready to be executed by the harness
     *  The first test should be a describe/it block that sets up the harness's compiler instance appropriately
     */
    initializeTests(): void {
        // Read in and evaluate the test list
        const testList = this.tests && this.tests.length ? this.tests : this.enumerateTestFiles();

        describe(`${this.kind()} code samples`, () => {
            for (const test of testList) {
                this.runTest(test);
            }
        });
    }
    private runTest(directoryName: string) {
        describe(directoryName, () => {
            const cp = require("child_process");

            it("should build successfully", () => {
                const cwd = path.join(__dirname, "../../", this.testDir, directoryName);
                const timeout = 600000; // 600s = 10 minutes
                if (fs.existsSync(path.join(cwd, "package.json"))) {
                    if (fs.existsSync(path.join(cwd, "package-lock.json"))) {
                        fs.unlinkSync(path.join(cwd, "package-lock.json"));
                    }
                    const stdio = isWorker ? "pipe" : "inherit";
                    const install = cp.spawnSync(`npm`, ["i"], { cwd, timeout, shell: true, stdio });
                    if (install.status !== 0) throw new Error(`NPM Install for ${directoryName} failed!`);
                }
                Harness.Baseline.runBaseline(`${this.kind()}/${directoryName}.log`, () => {
                    return this.report(cp.spawnSync(`node`, [path.join(__dirname, "tsc.js")], { cwd, timeout, shell: true }), cwd);
                });
            });
        });
    }
}

class UserCodeRunner extends ExternalCompileRunnerBase {
    readonly testDir = "tests/cases/user/";
    kind(): TestRunnerKind {
        return "user";
    }
    report(result: ExecResult) {
        // tslint:disable-next-line:no-null-keyword
        return result.status === 0 && !result.stdout.length && !result.stderr.length ? null : `Exit Code: ${result.status}
Standard output:
${result.stdout.toString().replace(/\r\n/g, "\n")}


Standard error:
${result.stderr.toString().replace(/\r\n/g, "\n")}`;
    }
}

class DefinitelyTypedRunner extends ExternalCompileRunnerBase {
    readonly testDir = "../DefinitelyTyped/types/";
    workingDirectory = this.testDir;
    kind(): TestRunnerKind {
        return "dt";
    }
    report(result: ExecResult, cwd: string) {
        const stdout = removeExpectedErrors(result.stdout.toString(), cwd);
        const stderr = result.stderr.toString();
        // tslint:disable-next-line:no-null-keyword
        return !stdout.length && !stderr.length ? null : `Exit Code: ${result.status}
Standard output:
${stdout.replace(/\r\n/g, "\n")}


Standard error:
${stderr.replace(/\r\n/g, "\n")}`;
    }
}

function removeExpectedErrors(errors: string, cwd: string): string {
    return ts.flatten(splitBy(errors.split("\n"), s => /^\S+/.test(s)).filter(isUnexpectedError(cwd))).join("\n");
}
/**
 * Returns true if the line that caused the error contains '$ExpectError',
 * or if the line before that one contains '$ExpectError'.
 * '$ExpectError' is a marker used in Definitely Typed tests,
 * meaning that the error should not contribute toward our error baslines.
 */
function isUnexpectedError(cwd: string) {
    return (error: string[]) => {
        ts.Debug.assertGreaterThanOrEqual(error.length, 1);
        const match = error[0].match(/(.+\.ts)\((\d+),\d+\): error TS/);
        if (!match) {
            return true;
        }
        const [, errorFile, lineNumberString] = match;
        const lines = fs.readFileSync(path.join(cwd, errorFile), { encoding: "utf8" }).split("\n");
        const lineNumber = parseInt(lineNumberString);
        ts.Debug.assertGreaterThanOrEqual(lineNumber, 0);
        ts.Debug.assertLessThan(lineNumber, lines.length);
        const previousLine = lineNumber - 1 > 0 ? lines[lineNumber - 1] : "";
        return !ts.stringContains(lines[lineNumber], "$ExpectError") && !ts.stringContains(previousLine, "$ExpectError");
    };
}
/**
 * Split an array into multiple arrays whenever `isStart` returns true.
 * @example
 * splitBy([1,2,3,4,5,6], isOdd)
 * ==> [[1, 2], [3, 4], [5, 6]]
 * where
 * const isOdd = n => !!(n % 2)
 */
function splitBy<T>(xs: T[], isStart: (x: T) => boolean): T[][] {
    const result = [];
    let group: T[] = [];
    for (const x of xs) {
        if (isStart(x)) {
            if (group.length) {
                result.push(group);
            }
            group = [x];
        }
        else {
            group.push(x);
        }
    }
    if (group.length) {
        result.push(group);
    }
    return result;
}
