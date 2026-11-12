package queue

import (
	"context"
	"log"
	"time"
)

type Message struct {
	ID   string
	Body []byte
}

type Forwarder interface {
	Forward(ctx context.Context, m Message) error
}

type Consumer struct {
	In      <-chan Message
	Fwd     Forwarder
	acks    chan string
	Timeout time.Duration
}

func (c *Consumer) Run(ctx context.Context) {
	c.acks = make(chan string, 16)
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-c.In:
			go c.handle(ctx, m)
		}
	}
}

func (c *Consumer) handle(ctx context.Context, m Message) {
	done := make(chan error)
	go func() { done <- c.Fwd.Forward(ctx, m) }()
	select {
	case err := <-done:
		if err == nil {
			c.acks <- m.ID
		}
	case <-time.After(c.Timeout):
		log.Printf("relay: ack timeout for msg %s after %s", m.ID, c.Timeout)
	}
}
