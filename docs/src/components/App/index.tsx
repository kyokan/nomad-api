import React, {ReactElement} from "react";
// @ts-ignore
import Logo from "../../../static/logo-purple.svg";
import "./app.scss";

export default function Index(): ReactElement {
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
          <div className="app__header__nav__item">
            Getting Started
          </div>
          <div className="app__header__nav__item">
            API
          </div>
          <div className="app__header__nav__item">
            GitHub
          </div>
        </div>
      </div>
      <div className="app__content">
        <div className="app__content__nav">

        </div>
        <div className="app__content__body">

        </div>
      </div>
    </div>
  )
}
