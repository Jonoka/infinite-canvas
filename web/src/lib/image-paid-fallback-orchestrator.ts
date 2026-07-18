export async function retryLitePoolFailuresWithConsent<T, F>(input: {
    results: PromiseSettledResult<T>[];
    isEligible: (error: unknown) => boolean;
    confirm: (input: { failedIndexes: number[]; count: number }) => Promise<F | null>;
    retry: (index: number, fallback: F) => Promise<T>;
}) {
    const failedIndexes = input.results.flatMap((result, index) => result.status === "rejected" && input.isEligible(result.reason) ? [index] : []);
    if (!failedIndexes.length) return input.results;
    const fallback = await input.confirm({ failedIndexes, count: failedIndexes.length });
    if (!fallback) return input.results;
    const output = [...input.results];
    await Promise.all(failedIndexes.map(async (index) => {
        try { output[index] = { status: "fulfilled", value: await input.retry(index, fallback) }; }
        catch (reason) { output[index] = { status: "rejected", reason }; }
    }));
    return output;
}

export async function retryLitePoolFailureWithConsent<T, F>(input: {
    result: PromiseSettledResult<T>;
    isEligible: (error: unknown) => boolean;
    confirm: (input: { failedIndexes: number[]; count: number }) => Promise<F | null>;
    retry: (index: number, fallback: F) => Promise<T>;
}) {
    return (await retryLitePoolFailuresWithConsent({ ...input, results: [input.result] }))[0];
}
