function compactItemFetchError(error) {
  const message = String(error?.message || "Unknown error")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `Cafe24 order item fetch failed after retry: ${message || "Unknown error"}`;
}

export async function fetchCafe24OrderItemsWithRetry(fetchItems, options = {}) {
  const wait = options.wait || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const delayMs = options.delayMs ?? 1200;
  try {
    return await fetchItems();
  } catch {
    await wait(delayMs);
  }
  try {
    return await fetchItems();
  } catch (error) {
    throw new Error(compactItemFetchError(error));
  }
}

export async function attachCafe24OrderItemsWithRetry(order, fetchItems, options = {}) {
  try {
    order.items = await fetchCafe24OrderItemsWithRetry(fetchItems, options);
    delete order.itemFetchError;
    return null;
  } catch (error) {
    order.items = [];
    order.itemFetchError = error.message;
    return error;
  }
}
