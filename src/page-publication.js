// Live columns remain untouched until the merchant explicitly publishes.
export function editablePage(page) {
  if (!page) return page;
  const draft = page.draftJson ? JSON.parse(page.draftJson) : null;
  return {
    ...page,
    ...(draft ? { title: draft.title, slug: draft.slug, body: draft.body, contentJson: draft.contentJson } : {}),
    liveSlug: page.status === 'published' ? page.slug : null,
    hasUnpublishedChanges: Boolean(draft),
  };
}

export function publishPageSnapshot(db, storeId, id) {
  const page = db.prepare('SELECT * FROM product_pages WHERE store_id=? AND id=? AND deleted_at IS NULL').get(storeId, id);
  if (!page) throw Error('Page not found');
  const draft = page.draft_json ? JSON.parse(page.draft_json) : {};
  db.prepare(`UPDATE product_pages SET title=?,slug=?,body=?,content_json=?,draft_json=NULL,
    status='published',published_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=? AND deleted_at IS NULL`)
    .run(draft.title ?? page.title, draft.slug ?? page.slug, draft.body ?? page.body,
      draft.contentJson ?? page.content_json, storeId, id);
}
