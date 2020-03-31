import React, {ReactElement, ReactNode, useState} from "react";
import {Redirect, Route, RouteComponentProps, Switch, withRouter} from "react-router";
// @ts-ignore
import Logo from "../../../static/logo-purple.svg";
import "./app.scss";
import {Nav, NavGroup, NavItem} from "../Nav";
import Markup from "../Markup";
// @ts-ignore
import GettingStartedMD from "../../../static/getting_started.md";
// @ts-ignore
import GetPostsMD from "../../../static/get_posts.md";
// @ts-ignore
import GetPostMD from "../../../static/get_post.md";
// @ts-ignore
import GetCommentsMD from "../../../static/get_comment_by_parent_hash.md";
// @ts-ignore
import GetUserTimelineMD from "../../../static/get_user_timeline.md";
// @ts-ignore
import GetUserLikesMD from "../../../static/get_user_likes.md";
// @ts-ignore
import GetUserFolloweeMD from "../../../static/get_user_followees.md";
// @ts-ignore
import GetUserBlockeeMD from "../../../static/get_user_blockees.md";
// @ts-ignore
import GetUserCommentsMD from "../../../static/get_user_comments.md";
// @ts-ignore
import GetUserProfileMD from "../../../static/get_user_profile.md";
// @ts-ignore
import PostFilterMD from "../../../static/get_posts_by_filter.md";
// @ts-ignore
import GetMediaMD from "../../../static/get_media.md";

function App(props: RouteComponentProps): ReactElement {
  const {
    location: { pathname },
    history: { push },
  } = props;

  const [isOpen, setOpen] = useState(false);

  return (
    <div className="app">
      <div className="app__header">
        <div className="app__header__title">
          <div
            className="app__header__title__hamburger"
            onClick={() => setOpen(true)}
          >
            menu
          </div>
          <div className="app__header__title__logo" style={{ backgroundImage: `url(${Logo})`}} />
          <div className="app__header__title__text">
            Nomad API
          </div>
        </div>
        <div className="app__header__nav">
          <div
            className="app__header__nav__item"
            onClick={() => push('/docs/introduction/getting_started')}
          >
            Getting Started
          </div>
          <div
            className="app__header__nav__item"
            onClick={() => push('/docs/api/get_posts')}
          >
            API
          </div>
          <div
            className="app__header__nav__item"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.open('https://github.com/kyokan/nomad-api', '__blank')
              }
            }}
          >
            GitHub
          </div>
        </div>
      </div>
      <div className="app__content">
        {renderNav(props, 'nav--desktop')}
        <div className={`app__content__mobile-nav ${isOpen ? 'app__content__mobile-nav--opened' : ''}`}>
          <div className="app__content__mobile-nav__body">
            <div className="app__header__title">
              <div className="app__header__title__logo" style={{ backgroundImage: `url(${Logo})`}} />
              <div className="app__header__title__text">
                Nomad API
              </div>
            </div>
            {renderNav(props, 'nav--mobile')}
          </div>
          <div
            className="app__content__mobile-nav__overlay"
            onClick={() => setOpen(false)}
          />
        </div>
        <div className="app__content__body">
          <Switch>
            <Route path="/docs/introduction/getting_started">
              <Markup content={GettingStartedMD} />
            </Route>
            <Route path="/docs/api/get_posts">
              <Markup content={GetPostsMD} />
            </Route>
            <Route path="/docs/api/get_post_by_refhash">
              <Markup content={GetPostMD} />
            </Route>
            <Route path="/docs/api/get_comments_by_parent_hash">
              <Markup content={GetCommentsMD} />
            </Route>
            <Route path="/docs/api/get_user_profile">
              <Markup content={GetUserProfileMD} />
            </Route>
            <Route path="/docs/api/get_user_timeline">
              <Markup content={GetUserTimelineMD} />
            </Route>
            <Route path="/docs/api/get_user_likes">
              <Markup content={GetUserLikesMD} />
            </Route>
            <Route path="/docs/api/get_user_followees">
              <Markup content={GetUserFolloweeMD} />
            </Route>
            <Route path="/docs/api/get_user_blockees">
              <Markup content={GetUserBlockeeMD} />
            </Route>
            <Route path="/docs/api/get_user_comments">
              <Markup content={GetUserCommentsMD} />
            </Route>
            <Route path="/docs/api/get_posts_by_filter">
              <Markup content={PostFilterMD} />
            </Route>
            <Route path="/docs/api/get_media">
              <Markup content={GetMediaMD} />
            </Route>
            <Route>
              <Redirect to="/docs/introduction/getting_started" />
            </Route>
          </Switch>
        </div>
      </div>
    </div>
  )
}

export default withRouter(App);


function renderNav(props: RouteComponentProps, className: string): ReactNode {
  const {
    location: { pathname },
    history: { push },
  } = props;

  return (
    <Nav className={className}>
      <NavGroup
        title="Introduction"
      >
        <NavItem
          selected={/introduction\/getting_started/.test(pathname)}
          title="Getting Started"
          onClick={() => {
            push('/docs/introduction/getting_started')
          }}
        />
      </NavGroup>
      <NavGroup
        title="API"
      >
        <NavItem
          selected={"/docs/api/get_posts" === pathname}
          title="GET /posts"
          onClick={() => {
            push('/docs/api/get_posts')
          }}
        />
        <NavItem
          selected={/api\/get_post_by_refhash/.test(pathname)}
          title="GET /posts/:refhash"
          onClick={() => {
            push('/docs/api/get_post_by_refhash')
          }}
        />
        <NavItem
          selected={/api\/get_comments_by_parent_hash/.test(pathname)}
          title="GET /posts/:refhash/comments"
          onClick={() => {
            push('/docs/api/get_comments_by_parent_hash')
          }}
        />
        <NavItem
          selected={/api\/get_user_profile/.test(pathname)}
          title="GET /users/:username/profile"
          onClick={() => {
            push('/docs/api/get_user_profile')
          }}
        />
        <NavItem
          selected={/api\/get_user_timeline/.test(pathname)}
          title="GET /users/:username/timeline"
          onClick={() => {
            push('/docs/api/get_user_timeline')
          }}
        />
        <NavItem
          selected={/api\/get_user_likes/.test(pathname)}
          title="GET /users/:username/likes"
          onClick={() => {
            push('/docs/api/get_user_likes')
          }}
        />
        <NavItem
          selected={/api\/get_user_comments/.test(pathname)}
          title="GET /users/:username/comments"
          onClick={() => {
            push('/docs/api/get_user_comments')
          }}
        />
        <NavItem
          selected={/api\/get_user_followees/.test(pathname)}
          title="GET /users/:username/followees"
          onClick={() => {
            push('/docs/api/get_user_followees')
          }}
        />
        <NavItem
          selected={/api\/get_user_blockees/.test(pathname)}
          title="GET /users/:username/blockees"
          onClick={() => {
            push('/docs/api/get_user_blockees')
          }}
        />

        <NavItem
          selected={/api\/get_posts_by_filter/.test(pathname)}
          title="POST /filter"
          onClick={() => {
            push('/docs/api/get_posts_by_filter')
          }}
        />
      </NavGroup>
    </Nav>
  );
}
