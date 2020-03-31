import React, {ReactElement, useCallback, MouseEvent} from "react";
import {markup} from "./rte";
import { withRouter, RouteComponentProps } from "react-router";
import './markup.scss';

type Props = {
  content: string;
  html?: string;
  handleOpenDiscuss?: () => void;
} & RouteComponentProps;

function Markup(props: Props): ReactElement {

  const onClick = useCallback(async (e: MouseEvent<HTMLDivElement>) => {
    // @ts-ignore
    const { tagName, href } = e.target;

    if (tagName === 'A') {
      e.stopPropagation();
      e.preventDefault();
      if (typeof window !== "undefined") {
        window.open(href, '_blank');
      }
      return;
    }
  }, []);

  return (
    <>
      <div
        className="marked"
        onClick={onClick}
      >
        <DangerousHTML content={props.content} html={props.html} />
      </div>
    </>
  )
}

export default withRouter(Markup);

function _DangerousHTML(props: { html?: string; content: string }): ReactElement {
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: props.html || markup(props.content),
      }}
    />
  )
}

const DangerousHTML = React.memo(_DangerousHTML);
