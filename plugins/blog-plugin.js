// Thanks to
// https://www.kgajera.com/blog/display-recent-blog-posts-on-home-page-with-docusaurus/

const blogPluginExports = require('@docusaurus/plugin-content-blog');
const defaultBlogPlugin = blogPluginExports.default;
require('dotenv').config();
const tweetToHTML = require('./tweet-to-html');
var TwitterClient = require('twitter-api-sdk').Client;

async function blogPluginExtended(...pluginArgs) {
  const blogPluginInstance = await defaultBlogPlugin(...pluginArgs);

  return {
    // Add all properties of the default blog plugin so existing functionality is preserved
    ...blogPluginInstance,
    /**
     * Override the default `contentLoaded` hook to access blog posts data
     */
    contentLoaded: async function (data) {
      var { setGlobalData, addRoute } = data.actions;

      const blogPosts = data.content.blogPosts;

      // find twitter id's in blogPosts and fetch them from twitter.
      // we have to do this at build time since twitter's api requires a
      // bearer token we can't share.
      const ids = [];
      blogPosts.forEach((post) => {
        // find expressions like `<Tweet id="1595283148073476097" />`,
        // load the tweets from twitter, and save them as post data globally
        // so the tweet component can access them.
        const find = /<Tweet id=(?:'|")(\d+)(?:'|")\s*\/>/g;
        var search = post.content;
        var match = find.exec(search);
        while (match != null) {
          ids.push(match[1]);
          match = find.exec(search);
        }
      });

      var twitterData = await fetchTweets(ids);
      setGlobalData({ twitterData: twitterData });
      console.log('twitterData =', JSON.stringify(twitterData, null, 2));

      // Get the 5 latest blog posts
      const recentPosts = [...blogPosts].splice(0, 5);

      addRoute({
        // Add route for the home page
        path: '/',
        exact: true,

        // The component to use for the "Home" page route
        component: '@site/src/components/home/home.tsx',

        // These are the props that will be passed to our "Home" page component
        modules: {
          recentPosts: recentPosts.map((post) => ({
            content: {
              __import: true,
              // The markdown file for the blog post will be loaded by webpack
              path: post.metadata.source,
              query: {
                truncated: true,
              },
            },
          })),
        },
      });

      // Call the default overridden `contentLoaded` implementation
      return blogPluginInstance.contentLoaded(data);
    },
  };
}

// returns a map of tweet id's to social post data if successful, otherwise an
// empty map. ids should be an array of tweet id strings.
async function fetchTweets(ids) {
  var TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

  const client = new TwitterClient(TWITTER_BEARER_TOKEN);

  const response = await client.tweets.findTweetsById({
    ids: ids,
    'tweet.fields': [
      'attachments',
      'author_id',
      'created_at',
      'entities',
      'source',
      'text',
      'public_metrics',
    ],
    expansions: [
      'attachments.media_keys',
      'author_id',
      'entities.mentions.username',
    ],
    'media.fields': [
      'alt_text',
      'height',
      'media_key',
      'preview_image_url',
      'type',
      'url',
      'width',
    ],
    'user.fields': [
      'id',
      'name',
      'url',
      'username',
      'verified',
      'profile_image_url',
    ],
  });

  const result = {};
  if (!response) {
    return result;
  }

  const includes = response.includes ?? {
    media: [],
    users: [],
  };

  for (var tweet of response.data ?? []) {
    result[tweet.id] = twitterDataToPostData(tweet, includes);
  }

  // returns a map of tweet id's to social post data.
  return result;
}

function twitterDataToPostData(data, includes) {
  const users = includes.users ?? [];

  const authorId = data.author_id;
  const metrics = data.public_metrics;

  const retweets = metrics.retweet_count;
  const likes = metrics.like_count;
  const quotes = metrics.quote_count;

  const createdAt = data.created_at ?? '';
  const user = users.find((user) => user.id === authorId);
  const username = user.username ?? '';
  const profileImage = user.profile_image_url ?? '';
  const name = user.name ?? '';
  const postId = data.id ?? '';

  // markup text based on the hashtags and urls
  const content = tweetToHTML.parse(data, includes);

  const html = content.html.split('\n\n');
  var string = '';
  for (var line of html) {
    var p = `<p>${line}</p>`;
    string += p;
  }

  return {
    url: 'https://twitter.com/' + user.username + '/status/' + postId,
    createdAt: createdAt,
    content: string,
    favoritesCount: quotes + likes,
    reblogsCount: retweets,
    account: {
      username: username,
      displayName: name,
      url: 'https://twitter.com/' + username,
      avatarUrl: profileImage,
    },
    // twitter attachments are included in the content html
    attachments: [],
  };
}

module.exports = {
  ...blogPluginExports,
  default: blogPluginExtended,
};
