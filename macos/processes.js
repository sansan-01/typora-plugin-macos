"use strict";

const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const MAX_OUTPUT = 1024 * 1024;
const IDLE_LIMIT = 60000;

function createProcessRoutes() {
    const jobs = new Map();

    function signalGroup(child, signal) {
        if (!child.pid) return;
        try { process.kill(-child.pid, signal); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
    }

    function terminate(job) {
        if (job.stopping || job.closed) return;
        job.stopping = true;
        signalGroup(job.child, "SIGTERM");
        job.force = setTimeout(() => signalGroup(job.child, "SIGKILL"), 1000);
        job.force.unref();
    }

    function start([command, args, options, input]) {
        if (jobs.size >= 24) throw new Error("Too many active processes");
        const { timeout, ...spawnOptions } = options || {};
        const child = spawn(command, args || [], {
            ...spawnOptions,
            detached: true,
            shell: spawnOptions.shell ?? false,
            env: { ...process.env, ...spawnOptions.env },
        });
        const id = randomUUID();
        const job = { child, output: [], size: 0, lastPoll: Date.now(), closed: false, error: null };
        jobs.set(id, job);

        for (const name of ["stdout", "stderr"]) {
            child[name]?.setEncoding("utf8").on("data", chunk => {
                if (job.size + Buffer.byteLength(chunk) > MAX_OUTPUT) {
                    job.error ||= "Command output exceeded the buffer limit";
                    terminate(job);
                    return;
                }
                job.output.push([name, chunk]);
                job.size += Buffer.byteLength(chunk);
            });
        }
        child.on("error", error => { job.error ||= error.message; });
        child.once("close", (code, signal) => {
            clearTimeout(job.timeout);
            clearTimeout(job.force);
            job.closed = true;
            job.code = code;
            job.signal = signal;
        });
        child.stdin?.on("error", error => {
            if (error.code !== "EPIPE") job.error ||= error.message;
        });
        child.stdin?.end(input || undefined);
        if (Number.isFinite(timeout) && timeout > 0) {
            job.timeout = setTimeout(() => terminate(job), timeout);
            job.timeout.unref();
        }
        return id;
    }

    function poll([id]) {
        const job = jobs.get(id);
        if (!job) throw new Error("Process is no longer available");
        const result = {
            output: job.output, closed: job.closed, code: job.code, signal: job.signal,
            error: job.closed ? job.error : null,
        };
        job.lastPoll = Date.now();
        job.output = [];
        job.size = 0;
        if (job.closed) jobs.delete(id);
        return result;
    }

    const sweep = setInterval(() => {
        for (const [id, job] of jobs) {
            if (Date.now() - job.lastPoll < IDLE_LIMIT) continue;
            terminate(job);
            jobs.delete(id);
        }
    }, IDLE_LIMIT / 2);
    sweep.unref();

    return {
        routes: {
            "child_process.start": start,
            "child_process.poll": poll,
            "child_process.kill": ([id]) => {
                const job = jobs.get(id);
                if (job) terminate(job);
                return !!job;
            },
        },
        shutdown() {
            clearInterval(sweep);
            for (const job of jobs.values()) {
                if (!job.closed) signalGroup(job.child, "SIGKILL");
            }
        },
    };
}

module.exports = { createProcessRoutes };
