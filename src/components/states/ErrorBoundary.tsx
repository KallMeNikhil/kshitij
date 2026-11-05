import { Component, type ReactNode } from "react";
import { ErrorState } from "./StateViews";

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  failed: boolean;
  key?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (this.state.failed) {
      return <ErrorState title="Something went wrong on this page" hint="Reload the page to try again." onRetry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}
