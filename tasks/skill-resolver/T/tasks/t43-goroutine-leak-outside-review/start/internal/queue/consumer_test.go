package queue

import (
	"context"
	"testing"
	"time"
)

type okFwd struct{}

func (okFwd) Forward(ctx context.Context, m Message) error { return nil }

func TestRunForwards(t *testing.T) {
	in := make(chan Message, 1)
	c := &Consumer{In: in, Fwd: okFwd{}, Timeout: time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)
	in <- Message{ID: "a"}
	time.Sleep(50 * time.Millisecond)
}
