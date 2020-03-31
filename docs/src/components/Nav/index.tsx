import React, {MouseEventHandler, ReactElement, ReactNode, useCallback, useState} from "react";
import "./nav.scss";

export function Nav(props: {children: ReactNode; className?: string}): ReactElement {
  return (
    <div className={`nav ${props.className || ''}`}>
      {props.children}
    </div>
  )
}

type NavGroupProps = {
  title: string;
  children: ReactNode;
}

export function NavGroup(props: NavGroupProps): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => setExpanded(!expanded), [expanded]);

  return (
    <div className={`nav-group ${expanded && 'nav-group--expanded'}`} onClick={toggle}>
      <div className="nav-group__title">{props.title}</div>
      <div className="nav-group__children">
        {expanded && props.children}
      </div>
    </div>
  )
}

type NavItemProps = {
  selected: boolean;
  title: string;
  onClick: MouseEventHandler;
}

export function NavItem(props: NavItemProps): ReactElement {
  return (
    <div
      className={`nav-item ${props.selected && 'nav-item--selected'}`}
      onClick={e => {
        e.stopPropagation();
        props.onClick(e);
      }}
      tabIndex={1}
    >
      <div className="nav-item__title">{props.title}</div>
    </div>
  )
}
