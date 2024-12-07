import {Octokit} from "@octokit/rest";
import dotenv from 'dotenv';

dotenv.config();
const octokit = new Octokit({
    auth: process.env.GH_TOKEN
});

export const run = async () => {
    const issues = await octokit.search.issuesAndPullRequests({
        q:
        'is:issue assignee:masaori archived:false 薬 is:open label:daily-routine',
        per_page: 100
    });
    return 'finished';
};

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
