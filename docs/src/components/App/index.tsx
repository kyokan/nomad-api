import React, {ReactElement} from "react";
import {Redirect, Route, RouteComponentProps, Switch, withRouter} from "react-router";
// @ts-ignore
import Logo from "../../../static/logo-purple.svg";
import "./app.scss";
import {Nav, NavGroup, NavItem} from "../Nav";
import Markup from "../Markup";
// @ts-ignore
import GettingStartedMD from "../../../static/getting_started.md";
import GetPostsMD from "../../../static/get_posts.md";
import GetUserTimeline from "../../../static/get_user_timeline.md";

function App(props: RouteComponentProps): ReactElement {
  const {
    location: { pathname },
    history: { push },
  } = props;

  return (
    <div className="app">
      <div className="app__header">
        <div className="app__header__title">
          <div className="app__header__title__logo" style={{ backgroundImage: `url(${Logo})`}} />
          <div className="app__header__title__text">
            Nomad API
          </div>
        </div>
        <div className="app__header__nav">
          <div
            className="app__header__nav__item"
            onClick={() => push('/introduction/getting_started')}
          >
            Getting Started
          </div>
          <div
            className="app__header__nav__item"
            onClick={() => push('/api')}
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
        <Nav>
          <NavGroup
            title="Introduction"
          >
            <NavItem
              selected={/introduction\/getting_started/.test(pathname)}
              title="Getting Started"
              onClick={() => {
                push('/introduction/getting_started')
              }}
            />
          </NavGroup>
          <NavGroup
            title="API"
          >
            <NavItem
              selected={/api\/get_posts/.test(pathname)}
              title="GET /posts"
              onClick={() => {
                push('/api/get_posts')
              }}
            />
            <NavItem
              selected={/api\/get_user_timeline/.test(pathname)}
              title="GET /users/:username/timeline"
              onClick={() => {
                push('/api/get_user_timeline')
              }}
            />
          </NavGroup>
        </Nav>
        <div className="app__content__body">
          <Switch>
            <Route path="/introduction/getting_started">
              <Markup content={GettingStartedMD} />
            </Route>
            <Route path="/api/get_posts">
              <Markup content={GetPostsMD} />
            </Route>
            <Route path="/api/get_user_timeline">
              <Markup content={GetUserTimeline} />
            </Route>
            <Route>
              <Redirect to="/introduction/getting_started" />
            </Route>
          </Switch>
        </div>
      </div>
    </div>
  )
}

export default withRouter(App);
