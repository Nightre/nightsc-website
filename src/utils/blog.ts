import type { CollectionEntry } from 'astro:content';

export type Locale = 'en' | 'zh' | 'ja';
type BlogPost = CollectionEntry<'blog'>;

export function getPostSlug(post: BlogPost) {
	return post.id.split('/').slice(1).join('/');
}

export function getLocalizedPosts(posts: BlogPost[], locale: Locale) {
	const groups = new Map<string, BlogPost[]>();

	for (const post of posts) {
		const slug = getPostSlug(post);
		groups.set(slug, [...(groups.get(slug) ?? []), post]);
	}

	return [...groups.entries()]
		.map(([slug, translations]) => {
			const byLanguage = new Map(translations.map((post) => [post.data.lang, post]));
			const post = byLanguage.get(locale)
				?? byLanguage.get('zh')
				?? byLanguage.get('en')
				?? byLanguage.get('ja')!;

			return { post, slug };
		})
		.sort((a, b) => b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf());
}
